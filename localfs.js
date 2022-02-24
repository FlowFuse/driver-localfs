/**
 * Local Container driver
 *
 * Handles the creation and deletation of containers to back Projects
 *
 * This driver creates Projects backed by userDirectories on the local file system
 *
 * @module localfs
 * @memberof forge.containers.drivers
 *
 */

const fs = require('fs')
const ps = require('ps-node')
const got = require('got')
const path = require('path')
const childProcess = require('child_process')

let initalPortNumber

const fileHandles = {}

let logger

function getNextFreePort (ports) {
    ports.sort((a, b) => { return a - b })
    let offset = ports[0]
    let lowest = -1
    for (let i = 0; i < ports.length; ++i) {
        if (ports[i] !== offset) {
            lowest = offset
            break
        }
        offset++
    }
    if (lowest === -1) {
        if (ports.length !== 0) {
            lowest = ports[ports.length - 1] + 1
        } else {
            lowest = initalPortNumber
        }
    }
    return lowest
}

function createUserDirIfNeeded (rootDir, id) {
    const userDir = path.join(rootDir, id)
    if (!fs.existsSync(userDir)) {
        logger.info(`Creating userDir ${userDir}`)
        fs.mkdirSync(userDir)
        fs.mkdirSync(path.join(userDir, 'node_modules'))
        fs.writeFileSync(path.join(userDir, 'package.json'),
            '{\n"name": "node-red-project",\n"description": "A Node-RED Project",\n"version": "0.0.1",\n"private": true\n }'
        )
    } else {
        logger.debug(`userDir already exists ${userDir}`)
    }
}

async function startProject (app, project, options, userDir, port) {
    const env = {} // JSON.parse(JSON.stringify(process.env))

    Object.assign(env, options.env)

    const authTokens = await project.refreshAuthTokens()

    env.FORGE_CLIENT_ID = authTokens.clientID
    env.FORGE_CLIENT_SECRET = authTokens.clientSecret
    env.FORGE_URL = app.config.api_url
    env.FORGE_PROJECT_ID = project.id
    env.FORGE_PROJECT_TOKEN = authTokens.token

    if (app.config.node_path) {
        env.PATH = process.env.PATH + path.delimiter + app.config.node_path
    } else {
        env.PATH = process.env.PATH
    }

    logger.debug(`Project Environment Vars ${JSON.stringify(env)}`)

    const out = fs.openSync(path.join(userDir, '/out.log'), 'a')
    const err = fs.openSync(path.join(userDir, '/out.log'), 'a')

    fileHandles[project.id] = {
        out: out,
        err: err
    }

    const processOptions = {
        detached: true,
        stdio: ['ignore', out, err],
        windowsHide: true,
        env: env,
        cwd: userDir
    }

    // this needs work
    const ext = process.platform === 'win32' ? '.cmd' : ''

    let execPath
    for (let i = 0; i < process.mainModule.paths.length; i++) {
        // execPath = path.join(process.mainModule.paths[i], `.bin/flowforge-node-red${ext}`)
        execPath = path.join(process.mainModule.paths[i], '@flowforge/nr-launcher/index.js')
        if (fs.existsSync(execPath)) {
            break
        }
    }
    if (!execPath) {
        logger.info('Can not find flowforge-node-red executable, no way to start projects')
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

function checkExistingProjects (driver, projects) {
    logger.debug('checking projects')

    projects.forEach(async (project) => {
        const projectSettings = await project.getAllSettings()
        driver._usedPorts.push(projectSettings.port)
        createUserDirIfNeeded(driver._rootDir, project.id)

        const localProjects = driver._projects
        ps.lookup({ pid: projectSettings.pid }, async function (err, results) {
            if (!err) {
                if (!results[0]) {
                    // let projectOpts = JSON.parse(project.options)
                    logger.info(`restating ${project.id}}`)
                    const pid = await startProject(driver._app, project, {}, projectSettings.path, projectSettings.port)

                    await project.updateSetting('pid', pid)
                    localProjects[project.id] = {
                        process: pid,
                        dir: project.path,
                        port: project.port,
                        state: 'running'
                    }
                } else {
                    // found
                    logger.debug(`found ${results[0].pid}`)
                    if (results[0].arguments.includes('--forgeURL') &&
                results[0].arguments.includes(project.id)) {
                        // should maybe hit the /flowforge/info endpoint
                        localProjects[project.id] = {
                            process: projectSettings.pid,
                            dir: projectSettings.path,
                            port: projectSettings.port,
                            state: 'running'
                        }
                    } else {
                        logger.info("matching pid, but doesn't match project id, restarting")
                        // should restart
                        const pid = await startProject(driver._app, project, {}, projectSettings.path, projectSettings.port)
                        await project.updateSetting('pid', pid)
                        localProjects[project.id] = {
                            process: pid,
                            dir: project.path,
                            port: project.port,
                            state: 'running'
                        }
                    }
                }
            }
        })
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
        this._usedPorts = []
        // TODO need a better way to find this location?
        this._rootDir = path.resolve(app.config.home, 'var/projects')

        initalPortNumber = app.config.driver.options?.start_port || 7880

        logger = app.log

        if (!fs.existsSync(this._rootDir)) {
            fs.mkdirSync(this._rootDir)
        }

        // TODO need to check DB and see if the pids exist
        const projects = await this._app.db.models.Project.findAll()

        checkExistingProjects(this, projects)
        const driver = this

        this._checkInterval = setInterval(async () => {
            const projects = await driver._app.db.models.Project.findAll()
            checkExistingProjects(driver, projects)
        }, 60000)

        // projects.forEach(async (project) => {
        //   const projectSettings = await project.getAllSettings();
        //   this._usedPorts.push(projectSettings.port)
        //   createUserDirIfNeeded(this._rootDir, project.id)

        //   let localProjects = this._projects
        //   ps.lookup({pid: projectSettings.pid}, async function(err, results){
        //     if (!err) {
        //       if (!results[0]) {
        //         // let projectOpts = JSON.parse(project.options)
        //         let pid = await startProject(project, {}, projectSettings.path, projectSettings.port);
        //         await project.updateSetting('pid',pid);
        //         localProjects[project.id] = {
        //           process: pid,
        //           dir: project.path,
        //           port: project.port,
        //           state: "running"
        //         }
        //       } else {
        //         //found
        //         console.log("found", results[0])
        //         if (results[0].arguments.includes('--forgeURL') &&
        //             results[0].arguments.includes(project.id)) {
        //           //should maybe hit the /flowforge/info endpoint
        //           localProjects[project.id] = {
        //             process: projectSettings.pid,
        //             dir: projectSettings.path,
        //             port: projectSettings.port,
        //             state: "running"
        //           }
        //         } else {
        //           console.log("matching pid, but doesn't match project id")
        //           //should restart
        //           let pid = await startProject(project, {}, projectSettings.path, projectSettings.port);
        //           await project.updateSetting('pid',pid);
        //           localProjects[project.id] = {
        //             process: pid,
        //             dir: project.path,
        //             port: project.port,
        //             state: "running"
        //           }
        //         }
        //       }
        //     }
        //   })
        // })

        // nothing to expose at the moment
        return {}
    },
    /**
   * Create a new Project
   * @param {Project} project - the project model instance
   * @param {forge.containers.Options} options - options for the project
   * @return {forge.containers.Project}
   */
    create: async (project, options) => {
        const directory = path.join(this._rootDir, project.id)
        createUserDirIfNeeded(this._rootDir, project.id)

        const port = getNextFreePort(this._usedPorts)
        this._usedPorts.push(port)

        const pid = await startProject(this._app, project, options, directory, port)
        logger.info(`PID ${pid}, port, ${port}, directory, ${directory}`)

        await project.updateSettings({
            pid: pid,
            path: directory,
            port: port
        })

        const baseURL = new URL(this._app.config.base_url)
        baseURL.port = port

        project.url = baseURL.href // "http://localhost:" + port;
        await project.save()

        this._projects[project.id] = {
            process: pid,
            dir: directory,
            port: port,
            state: 'running'
        }
    },
    /**
   * Removes a Project
   * @param {Project} project - the project model instance
   * @return {Object}
   */
    remove: async (project) => {
        const projectSettings = await project.getAllSettings()
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
            fs.close(fileHandles[project.id].out)
            fs.close(fileHandles[project.id].err)
            delete fileHandles[project.id]
        }

        setTimeout(() => {
            fs.rmSync(projectSettings.path, { recursive: true, force: true })
        }, 5000)

        this._usedPorts = this._usedPorts.filter(item => item !== this._projects[project.id].port)

        delete this._projects[project.id]

        return { status: 'okay' }
    },
    /**
    * Retrieves details of a project's container
    * @param {Project} project - the project model instance
    * @return {Object}
    */
    details: async (project) => {
        const port = await project.getSetting('port')
        const infoURL = 'http://localhost:' + (port + 1000) + '/flowforge/info'
        try {
            const info = JSON.parse((await got.get(infoURL)).body)
            return info
        } catch (err) {
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
            const projectSettings = await project.getAllSettings()
            settings.projectID = project.id
            // settings.env = options.env
            settings.rootDir = this._rootDir
            settings.userDir = project.id
            settings.port = projectSettings.port
            const baseURL = new URL(this._app.config.base_url)
            baseURL.port = projectSettings.port
            settings.baseURL = baseURL.href.slice(0, -1) // `http://localhost:${projectSettings.port}`
            settings.forgeURL = this._app.config.base_url
            settings.env = {
                NODE_PATH: path.join(this._app.config.home, 'app', 'node_modules')
            }
        }
        // settings.state is set by the core forge app before this returns to
        // the launcher

        return settings
    },
    /**
   * Lists all containers
   * @param {string} filter - rules to filter the containers
   * @return {Object}
   */
    list: async (filter) => {
    // TODO work out what filtering needs to be done
        const projects = await this._app.db.models.Project.findAll()
        return projects
    },
    /**
   * Starts a Project's container
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
    start: async (project) => {
        const port = await project.getSetting('port')

        await got.post('http://localhost:' + (port + 1000) + '/flowforge/command', {
            json: {
                cmd: 'start'
            }
        })

        project.state = 'starting'

        return { status: 'okay' }
    },
    /**
   * Stop a Project's container
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
    stop: async (project) => {
        const port = await project.getSetting('port')
        await got.post('http://localhost:' + (port + 1000) + '/flowforge/command', {
            json: {
                cmd: 'stop'
            }
        })
        // process.kill(project.pid,'SIGTERM')
        project.state = 'stopped'
        project.save()
        return Promise.resolve({ status: 'okay' })
    },
    /**
   * Restarts a Project's container
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
    restart: async (project) => {
        const port = await project.getSetting('port')

        await got.post('http://localhost:' + (port + 1000) + '/flowforge/command', {
            json: {
                cmd: 'restart'
            }
        })

        return { state: 'okay' }
    },

    /**
   * Get a Project's logs
   * @param {Project} project - the project model instance
   * @return {array} logs
   */
    logs: async (project) => {
        const port = await project.getSetting('port')
        const result = await got.get('http://localhost:' + (port + 1000) + '/flowforge/logs').json()
        return result
    },
    /**
     * Shutdown driver
     */
    shutdown: async () => {
        clearInterval(this._checkInterval)
    }
}
