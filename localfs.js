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

const fs = require('fs');
const ps = require('ps-node');
const got = require('got');
const path = require('path');
const childProcess = require('child_process');

const initalPortNumber = process.env["LOCALFS_START_PORT"] || 7880

var fileHandles = {}

function getNextFreePort(ports) {
  ports.sort((a,b) => {return a-b});
  let offset = ports[0];
  let lowest = -1;
  for (i=0; i<ports.length; ++i) {
    if (ports[i] != offset) {
      lowest = offset;
      break;
    }
    offset++
  }
  if (lowest == -1) {
    if (ports.length != 0) {
      lowest = ports[ports.length -1] + 1;
    } else {
      lowest = initalPortNumber
    }
  }
  return lowest
}

function createUserDirIfNeeded(rootDir, id) {
  let userDir = path.join(rootDir, id)
  if (!fs.existsSync(userDir)) {
    console.log("creating userDir", userDir)
    fs.mkdirSync(userDir)
    fs.mkdirSync(path.join(userDir, "node_modules"))
    fs.writeFileSync(path.join(userDir, "package.json"),
      '{\n"name": "node-red-project",\n"description": "A Node-RED Project",\n"version": "0.0.1",\n"private": true\n }'
      )
  } else {
    console.log("userDir already exists", userDir)
  }
}

async function startProject(project, options, userDir, port) {

  let env = {} //JSON.parse(JSON.stringify(process.env))

  Object.assign(env, options.env)

  const authTokens = await project.refreshAuthTokens();

  env["FORGE_CLIENT_ID"] = authTokens.clientID;
  env["FORGE_CLIENT_SECRET"] = authTokens.clientSecret;
  env["FORGE_URL"] = process.env["BASE_URL"];
  env["FORGE_PROJECT_ID"] = project.id;
  env["FORGE_PROJECT_TOKEN"] = authTokens.token;

  // env["FORGE_STORAGE_URL"] = process.env["BASE_URL"] + "/storage";
  // env["FORGE_STORAGE_TOKEN"] = options.projectToken || "ABCD";
  // env["FORGE_AUDIT_URL"] = process.env["BASE_URL"] + "/logging";
  // env["FORGE_AUDIT_TOKEN"] = options.projectToken || "ABCD";

  if (process.env["LOCALFS_NODE_PATH"]) {
    env["PATH"] = process.env["PATH"]+path.delimiter+process.env.LOCALFS_NODE_PATH
  } else {
    env["PATH"] = process.env["PATH"]
  }

  console.log(env);

  const out = fs.openSync(path.join(userDir,'/out.log'), 'a');
  const err = fs.openSync(path.join(userDir,'/out.log'), 'a');


  fileHandles[project.id] = {
    out: out,
    err: err
  }

  let processOptions = {
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    env: env,
    cwd: userDir
  }

  //this needs work
  let ext = process.platform == "win32" ? ".cmd" : ""

  let execPath = undefined;
  for (let i=0; i<process.mainModule.paths.length; i++) {
    execPath = path.join(process.mainModule.paths[i], `.bin/flowforge-node-red${ext}`)
    if (fs.existsSync(execPath)) {
      break;
    }
  }
  if (!execPath){
    console.log("Can not find flowforge-node-red executable, no way to start projects")
    process.exit(1)
  }

  console.log("exec path",execPath)

  let args = [
    '-p',
    port + 1000,
    '--forgeURL',
    process.env["BASE_URL"],
    '--project',
    project.id,
    // '--token',
    // options.projectToken
    ]

  let proc = childProcess.spawn(execPath,args,processOptions);

  proc.unref();

  return proc.pid;
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
    //TODO need a better way to find this location?
    this._rootDir = path.resolve(process.env["LOCALFS_ROOT"] || path.join(process.mainModule.path, "containers/localfs_root"))

    if (!fs.existsSync(this._rootDir)) {
      fs.mkdirSync(this._rootDir)
    }

    //TODO need to check DB and see if the pids exist
    let projects = await this._app.db.models.Project.findAll()
    //console.log(projects)

    projects.forEach(async (project) => {
      const projectSettings = await project.getAllSettings();
      this._usedPorts.push(projectSettings.port)
      createUserDirIfNeeded(this._rootDir, project.id)

      let localProjects = this._projects
      ps.lookup({pid: projectSettings.pid}, async function(err, results){
        if (!err) {
          if (!results[0]) {
            // let projectOpts = JSON.parse(project.options)
            let pid = await startProject(project, {}, projectSettings.path, projectSettings.port);
            await project.updateSetting('pid',pid);
            localProjects[project.id] = {
              process: pid,
              dir: project.path,
              port: project.port,
              state: "running"
            }
          } else {
            //found
            console.log("found", results[0])
            if (results[0].arguments.includes('--forgeURL') &&
                results[0].arguments.includes(project.id)) {
              //should maybe hit the /flowforge/info endpoint
              localProjects[project.id] = {
                process: projectSettings.pid,
                dir: projectSettings.path,
                port: projectSettings.port,
                state: "running"
              }
            } else {
              console.log("matching pid, but doesn't match project id")
              //should restart
              let pid = await startProject(project, {}, projectSettings.path, projectSettings.port);
              await project.updateSetting('pid',pid);
              localProjects[project.id] = {
                process: pid,
                dir: project.path,
                port: project.port,
                state: "running"
              }
            }
          }
        }
      })
    })

    //nothing to expose at the moment
    return {}
  },
   /**
   * Create a new Project
   * @param {Project} project - the project model instance
   * @param {forge.containers.Options} options - options for the project
   * @return {forge.containers.Project}
   */
  create: async (project, options) => {

    let directory = path.join(this._rootDir, project.id)
    createUserDirIfNeeded(this._rootDir, project.id)

    const port = getNextFreePort(this._usedPorts);
    this._usedPorts.push(port);

    let pid = await startProject(project, options, directory, port)
    console.log("PID",pid, "port", port, "directory", directory)

    await project.updateSettings({
        pid: pid,
        path: directory,
        port: port,
    })

    let baseURL = new URL(process.env['BASE_URL'])
    base.port = port

    project.url = baseURL.href; //"http://localhost:" + port;
    await project.save()

    this._projects[project.id] = {
      process: pid,
      dir: directory,
      port: port,
      state: "running"
    }
    return
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
          process.kill(projectSettings.pid,'SIGTERM')
        }
      } catch (err) {
        //probably means already stopped
      }

      if (fileHandles[project.id]) {
          fs.close(fileHandles[project.id].out)
          fs.close(fileHandles[project.id].err)
          delete fileHandles[project.id]
      }

      setTimeout(() => {
        fs.rmSync(projectSettings.path,{recursive: true, force: true})
      }, 5000)

      this._usedPorts = this._usedPorts.filter( item => item != this._projects[project.id].port)

      delete this._projects[project.id]

      return { status: "okay" }
  },
  /**
    * Retrieves details of a project's container
    * @param {Project} project - the project model instance
    * @return {Object}
    */
  details: async (project) => {
    const port = await project.getSetting('port')
    let infoURL = "http://localhost:"+ (port + 1000) + "/flowforge/info"
    try {
      let info = JSON.parse((await got.get(infoURL)).body)
      return info
    } catch (err) {
      //TODO
      return
    }
  },
  /**
   * Returns the settings for the project
   * @param {Project} project - the project model instance
   */
  settings: async (project) => {
    var settings = {}
    if (project) {
      const projectSettings = await project.getAllSettings()
      settings.projectID = project.id
      // settings.env = options.env
      settings.rootDir = this._rootDir
      settings.userDir = project.id
      settings.port = projectSettings.port
      let baseURL = new URL(process.env['BASE_URL'])
      baseURL.port = projectSettings.port
      settings.baseURL = baseURL.href.slice(0,-1) //`http://localhost:${projectSettings.port}`
      settings.forgeURL = process.env["BASE_URL"]
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
    //TODO work out what filtering needs to be done
    let projects = await this._app.db.models.Project.findAll();
    return projects;
  },
  /**
   * Starts a Project's container
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
  start: async (project) => {
    const port = await project.getSetting('port')

    await got.post("http://localhost:" + (port + 1000) + "/flowforge/command",{
      json: {
        cmd: "start"
      }
    })

    project.state = "starting"

    return {status: "okay"}
  },
  /**
   * Stop a Project's container
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
  stop: async (project) => {
    const port = await project.getSetting('port')
    await got.post("http://localhost:" + (port + 1000) + "/flowforge/command",{
      json: {
        cmd: "stop"
      }
    })
    // process.kill(project.pid,'SIGTERM')
    project.state = "stopped";
    project.save()
    return Promise.resolve({status: "okay"})
  },
  /**
   * Restarts a Project's container
   * @param {Project} project - the project model instance
   * @return {forge.Status}
   */
  restart: async (project) => {
    const port = await project.getSetting('port')

    await got.post("http://localhost:" + (port + 1000) + "/flowforge/command",{
      json: {
        cmd: "restart"
      }
    })

    return {state: "okay"}
  },

  /**
   * Get a Project's logs
   * @param {Project} project - the project model instance
   * @return {array} logs
   */
  logs: async (project) => {
    const port = await project.getSetting('port')
    let result = await got.get("http://localhost:" + (port + 1000) + "/flowforge/logs").json()
    return result;
  }
}
