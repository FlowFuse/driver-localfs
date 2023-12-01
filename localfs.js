/**
 * Local Container driver
 *
 * Handles the creation and deletion of containers to back Projects
 *
 * This driver creates Projects backed by userDirectories on the local file system
 *
 * @module localfs
 * @memberof forge.containers.drivers
 *
 */

const fs = require('fs/promises')
const { existsSync, openSync, close, readdirSync } = require('fs')
const got = require('got')
const path = require('path')
const semver = require('semver')
const childProcess = require('child_process')

let initialPortNumber

const fileHandles = {}

let logger

function getNextFreePort (ports) {
    let port = initialPortNumber
    while (ports.has(port)) {
        port++
    }
    return port
}

async function createUserDirIfNeeded (userDir) {
    if (!existsSync(userDir)) {
        logger.info(`Creating settings directory: ${userDir}`)
        await fs.mkdir(userDir)
        await fs.mkdir(path.join(userDir, 'node_modules'))
        const packageJSON = {
            name: 'flowfuse-node-red-project',
            description: 'A FlowFuse Node-RED Instance',
            version: '0.0.1',
            private: true
        }
        await fs.writeFile(path.join(userDir, 'package.json'),
            JSON.stringify(packageJSON)
        )
    }
}

async function startProject (app, project, ProjectStack, userDir, port) {
    const env = {} // JSON.parse(JSON.stringify(process.env))

    const authTokens = await project.refreshAuthTokens()

    env.FORGE_CLIENT_ID = authTokens.clientID
    env.FORGE_CLIENT_SECRET = authTokens.clientSecret
    env.FORGE_URL = app.config.api_url
    env.FORGE_TEAM_ID = app.db.models.Team.encodeHashid(project.TeamId)
    env.FORGE_PROJECT_ID = project.id
    env.FORGE_PROJECT_TOKEN = authTokens.token
    env.FORGE_NR_SECRET = await project.getSetting('credentialSecret')
    // Inbound connections for localfs enabled by default
    env.FORGE_NR_NO_TCP_IN = false // MVP. Future iteration could present this to YML or UI
    env.FORGE_NR_NO_UDP_IN = false// MVP. Future iteration could present this to YML or UI
    if (authTokens.broker) {
        env.FORGE_BROKER_URL = authTokens.broker.url
        env.FORGE_BROKER_USERNAME = authTokens.broker.username
        env.FORGE_BROKER_PASSWORD = authTokens.broker.password
    }
    if (app.license.active()) {
        env.FORGE_LICENSE_TYPE = 'ee'
    }

    if (app.config.node_path) {
        env.PATH = process.env.PATH + path.delimiter + app.config.node_path
    } else {
        env.PATH = process.env.PATH
    }

    //fully qualified path to ca.pem file
    if (app.config.driver.options.privateCA && fs.existsSync(this._app.config.driver.options.privateCA)) {
        env.NODE_EXTRA_CA_CERTS = app.config.driver.options.privateCA
    }

    logger.debug(`Stack info ${JSON.stringify(ProjectStack?.properties)}`)
    /*
     * ProjectStack.properties will contain the stack properties for this project
     *
     * This driver specifices two properties:
     *  - memory  : the value to apply to max-old-space-size
     *              This gets passed to the project instance via the /:projectId/settings
     *              endpoint - so this driver doesn't need to anything more with it
     *  - nodered : the version of node-red to use
     *              This driver needs to ensure the launcher is started using that
     *              version of Node-RED. We assume the admin has installed it to a well-known
     *              location using a set of instructions we provide (to be written)
     */
    if (ProjectStack?.properties.nodered) {
        env.FORGE_NR_PATH = path.resolve(app.config.home, 'var/stacks', ProjectStack.properties.nodered)
        logger.info(`Set FORGE_NR_PATH to ${env.FORGE_NR_PATH}`)
    }

    // logger.debug(`Project Environment Vars ${JSON.stringify(env)}`)

    const out = openSync(path.join(userDir, '/out.log'), 'a')
    const err = openSync(path.join(userDir, '/out.log'), 'a')

    fileHandles[project.id] = {
        out,
        err
    }

    const processOptions = {
        detached: true,
        stdio: ['ignore', out, err],
        windowsHide: true,
        env,
        cwd: userDir
    }

    // this needs work
    // const ext = process.platform === 'win32' ? '.cmd' : ''

    let execPath
    for (let i = 0; i < module.paths.length; i++) {
        // execPath = path.join(process.mainModule.paths[i], `.bin/flowforge-node-red${ext}`)
        execPath = path.join(module.paths[i], '@flowfuse/nr-launcher/index.js')
        if (existsSync(execPath)) {
            break
        }
        execPath = null
    }
    if (!execPath) {
        logger.info('Can not find flowfuse-node-red executable, no way to start projects')
        process.exit(1)
    }

    logger.debug(`exec path ${execPath}`)

    const args = [
        execPath, // new
        '-p',
        port + 1000,
        '--forgeURL',
        app.config.base_url,
        '--project',
        project.id
    // '--token',
    // options.projectToken
    ]

    // const proc = childProcess.spawn(execPath, args, processOptions)
    const proc = childProcess.spawn(process.execPath, args, processOptions)

    proc.unref()

    return proc.pid
}

function stopProject (app, project, projectSettings) {
    try {
        if (process.platform === 'win32') {
            childProcess.exec(`taskkill /pid ${projectSettings.pid} /T /F`)
        } else {
            process.kill(projectSettings.pid, 'SIGTERM')
        }
    } catch (err) {
    // probably means already stopped
    }

    if (fileHandles[project.id]) {
        close(fileHandles[project.id].out)
        close(fileHandles[project.id].err)
        delete fileHandles[project.id]
    }
}

async function getProjectList (driver) {
    // Get a list of all projects - with the absolute minimum of fields returned
    const projects = await driver._app.db.models.Project.findAll({
        attributes: [
            'id',
            'state',
            'ProjectStackId',
            'TeamId'
        ],
        include: [
            {
                model: driver._app.db.models.ProjectSettings,
                where: { key: driver._app.db.sequelize.or('port', 'path') }
            }
        ]
    })
    projects.forEach(async (project) => {
        const projectSettings = {}
        // Remap the project settings to make them accessible
        project.ProjectSettings.forEach(ps => {
            projectSettings[ps.key] = ps.value
        })
        driver._usedPorts.add(projectSettings.port)
        if (driver._projects[project.id] === undefined) {
            driver._projects[project.id] = {
                state: 'unknown'
            }
        }
        project._settings = projectSettings
    })
    return projects
}

async function checkExistingProjects (driver) {
    logger.debug('[localfs] Checking project status')

    const projects = await getProjectList(driver)
    projects.forEach(async (project) => {
        const projectSettings = project._settings
        // Suspended projects don't get restarted
        if (project.state === 'suspended') {
            return
        }

        logger.debug(`[localfs] Project ${project.id} port ${projectSettings.port}`)

        const directory = path.join(driver._rootDir, project.id)
        await createUserDirIfNeeded(directory)

        try {
            const info = await got.get(`http://localhost:${projectSettings.port + 1000}/flowforge/info`, {
                timeout: {
                    request: 1000
                }
            }).json()
            if (project.id !== info.id) {
                // Running project doesn't match db
                logger.warn(`[localfs] Project ${project.id} expected on port ${projectSettings.port}. Found ${info.id}`)
                // TODO should do something here...
            } else {
                driver._projects[project.id] = {
                    state: 'started'
                }
            }
        } catch (err) {
            logger.info(`Starting project ${project.id} on port ${projectSettings.port}`)

            const projectStack = await project.getProjectStack()

            const pid = await startProject(driver._app, project, projectStack, projectSettings.path, projectSettings.port)
            await project.updateSetting('pid', pid)
            driver._projects[project.id] = {
                state: 'started'
            }
        }
    })
}

module.exports = {
    /**
     * Initialises this driver
     * @param {string} app - the Vue application
     * @param {object} options - A set of configuration options for the driver
     * @return {forge.containers.ProjectArguments}
     */
    init: async (app, options) => {
        this._app = app
        this._options = options
        this._projects = {}
        this._usedPorts = new Set()
        // TODO need a better way to find this location?
        this._rootDir = path.resolve(app.config.home, 'var/projects')
        this._stackDir = path.resolve(app.config.home, 'var/stacks')

        initialPortNumber = app.config.driver.options?.start_port || 12080

        logger = app.log

        if (!existsSync(this._rootDir)) {
            await fs.mkdir(this._rootDir)
        }

        // Ensure we have our local list of projects up to date
        await getProjectList(this)
        this._initialCheckTimeout = setTimeout(() => {
            app.log.debug('[localfs] Restarting projects')
            checkExistingProjects(this)
        }, 1000)
        this._checkInterval = setInterval(() => {
            checkExistingProjects(this)
        }, 60000)
        return {
            stack: {
                properties: {
                    nodered: {
                        label: 'Node-RED Version',
                        description: 'This must match a version installed on the platform. See the docs for how to setup stacks locally.',
                        validate: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-.*)?$',
                        invalidMessage: 'Invalid version number - expected x.y.z'
                    },
                    memory: {
                        label: 'Memory (MB)',
                        description: 'This is the point at which the runtime will start garbage collecting unused memory. Recommended minimum: 256',
                        validate: '^[1-9]\\d+$',
                        invalidMessage: 'Invalid value - must be a number'
                    }
                }
            }
        }
    },
    /**
     * Start a Project
     * @param {Project} project - the project model instance
     */
    start: async (project) => {
        // Setup project directory
        const directory = path.join(this._rootDir, project.id)
        await createUserDirIfNeeded(directory)

        // Check if the project has a port assigned already
        let port = await project.getSetting('port')

        if (port === undefined) {
            // This project has never been run, so assign a new port to it
            port = getNextFreePort(this._usedPorts)
            this._usedPorts.add(port)
        }

        this._projects[project.id] = {
            state: 'starting'
        }

        await project.updateSettings({
            path: directory,
            port
        })

        const baseURL = new URL(this._app.config.base_url)
        baseURL.port = port
        project.url = baseURL.href
        await project.save()

        // Kick-off the project start and return the promise to let it
        // complete asynchronously
        return startProject(this._app, project, project.ProjectStack, directory, port).then(async pid => {
            return new Promise(resolve => {
                // These is a race condition when running locally where the UI
                // creates a project then immediate reloads it. That can hit
                // a timing window where the project creation completes mid-request
                setTimeout(async () => {
                    logger.debug(`PID ${pid}, port, ${port}, directory, ${directory}`)
                    await project.updateSetting('pid', pid)
                    this._projects[project.id].state = 'started'
                    resolve()
                }, 1000)
            })
        })
    },
    /**
     * Stops a project from running, but doesn't clear its state as it could
     * get restarted and we want to preserve port number and user dir
     * @param {*} project
     */
    stop: async (project) => {
        const projectSettings = await project.getAllSettings()
        this._projects[project.id].state = 'suspended'
        stopProject(this._app, project, projectSettings)
    },

    /**
     * Removes a Project
     * @param {Project} project - the project model instance
     * @return {Object}
     */
    remove: async (project) => {
        const projectSettings = await project.getAllSettings()
        stopProject(this._app, project, projectSettings)

        setTimeout(async () => {
            try {
                await fs.rm(projectSettings.path, { recursive: true, force: true })
            } catch (error) {
                logger.warn(`Error removing project files: ${projectSettings.path}`)
            }
        }, 5000)

        this._usedPorts.delete(projectSettings.port)
        delete this._projects[project.id]
    },
    /**
    * Retrieves details of a project's container
    * @param {Project} project - the project model instance
    * @return {Object}
    */
    details: async (project) => {
        if (this._projects[project.id] === undefined) {
            return { state: 'unknown' }
        }
        if (this._projects[project.id].state !== 'started') {
            // We should only poll the launcher if we think it is running.
            // Otherwise, return our cached state
            return {
                state: this._projects[project.id].state
            }
        }
        const port = await project.getSetting('port')
        const infoURL = 'http://localhost:' + (port + 1000) + '/flowforge/info'
        try {
            const info = JSON.parse((await got.get(infoURL)).body)
            return info
        } catch (err) {
            console.log(err)
            // TODO
        }
    },
    /**
     * Returns the settings for the project
     * @param {Project} project - the project model instance
     */
    settings: async (project) => {
        const settings = {}
        if (project) {
            settings.projectID = project.id
            settings.rootDir = this._rootDir
            settings.userDir = project.id
            settings.port = await project.getSetting('port')
            settings.env = {
                NODE_PATH: path.join(this._app.config.home, 'app', 'node_modules')
            }
        }
        // settings.state is set by the core forge app before this returns to
        // the launcher

        // settings.stack is set by the core forge app

        return settings
    },

    /**
     * Starts the flows
     * @param {Project} project - the project model instance
     */
    startFlows: async (project) => {
        if (this._projects[project.id] === undefined) {
            throw new Error('Project cannot start flows')
        }
        const port = await project.getSetting('port')
        await got.post('http://localhost:' + (port + 1000) + '/flowforge/command', {
            json: {
                cmd: 'start'
            }
        })
    },
    /**
   * Stops the flows
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
    stopFlows: async (project) => {
        if (this._projects[project.id] === undefined) {
            throw new Error('Project cannot stop flows')
        }
        const port = await project.getSetting('port')
        await got.post('http://localhost:' + (port + 1000) + '/flowforge/command', {
            json: {
                cmd: 'stop'
            }
        })
    },
    /**
   * Restarts the flows
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
    restartFlows: async (project) => {
        if (this._projects[project.id] === undefined) {
            throw new Error('Project cannot restart flows')
        }
        const port = await project.getSetting('port')
        await got.post('http://localhost:' + (port + 1000) + '/flowforge/command', {
            json: {
                cmd: 'restart'
            }
        })
    },
    /**
   * Logout Node-RED instance
   * @param {Project} project - the project model instance
   * @param {string} token - the node-red token to revoke
   * @return {forge.Status}
   */
    revokeUserToken: async (project, token) => { // logout:nodered(step-3)
        const port = await project.getSetting('port')
        try {
            this._app.log.debug(`[localfs] Project ${project.id} - logging out node-red instance`)
            await got.post('http://localhost:' + (port + 1000) + '/flowforge/command', { // logout:nodered(step-4)
                json: {
                    cmd: 'logout',
                    token
                }
            })
        } catch (error) {
            logger.error(`[localfs] Project ${project.id} - error in 'revokeUserToken': ${error.stack}`)
        }
    },

    /**
   * Get a Project's logs
   * @param {Project} project - the project model instance
   * @return {array} logs
   */
    logs: async (project) => {
        if (this._projects[project.id] === undefined) {
            throw new Error('Cannot get project logs')
        }
        const port = await project.getSetting('port')
        const result = await got.get('http://localhost:' + (port + 1000) + '/flowforge/logs').json()
        return result
    },
    /**
     * Shutdown driver
     */
    shutdown: async () => {
        clearTimeout(this._initialCheckTimeout)
        clearInterval(this._checkInterval)
    },
    /**
     * getDefaultStackProperties
     */
    getDefaultStackProperties: () => {
        const properties = {
            memory: 256,
            ...this._app.config.driver.options?.default_stack
        }

        // allow stack value to be passing in from config
        if (!properties.nodered) {
            const entries = readdirSync(this._stackDir, { withFileTypes: true })
            const directories = entries.filter(dir => {
                return dir.isDirectory() && semver.valid(dir.name)
            }).map(dir => dir.name)
                .sort((a, b) => {
                    if (semver.gt(a, b)) {
                        return -1
                    } else {
                        return 1
                    }
                })
            if (directories[0]) {
                properties.nodered = directories[0]
            } else {
                throw new Error(`No Stacks found in ${this._stackDir}`)
            }
        } else {
            const preconfiguredStack = path.join(this._stackDir, properties.nodered)
            if (!fs.existsSync(preconfiguredStack)) {
                throw new Error(`Stack not found: ${preconfiguredStack}`)
            }
        }
        return properties
    }
}
