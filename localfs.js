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
const ps = require('ps');
const got = require('got');
const path = require('path');
const childProcess = require('child_process');

const initalPortNumber = 7000

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

function startProject(id, options, userDir, port) {

  let env = {} //JSON.parse(JSON.stringify(process.env))

  Object.assign(env, options.env)

  // env["FORGE_CLIENT_ID"] = options.clientID;
  // env["FORGE_CLIENT_SECRET"] = options.clientSecret;
  env["FORGE_URL"] = process.env["BASE_URL"];
  // env["BASE_URL"] = "http://localhost:" + port;
  env["FORGE_PROJECT_ID"] = id;
  env["FORGE_PROJECT_TOKEN"] = options.projectToken || "ABCD";
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
    id,
    '--token',
    options.projectToken
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

    require('./models/Project')(app.db)

    if (!fs.existsSync(this._rootDir)) {
      fs.mkdirSync(this._rootDir)
    }

    //TODO need to check DB and see if the pids exist
    let projects = await this._app.db.models.LocalFSProject.findAll()
    //console.log(projects)

    projects.forEach(async (project) => {
      let [proc] = await ps({pid: project.pid})
      this._usedPorts.push(project.port)
      console.log(proc)

      createUserDirIfNeeded(this._rootDir, project.id)
      if (!proc) {
        //need to restart here
        this._usedPorts.push(project.port);

        let projectOpts = JSON.parse(project.options)

        let pid = startProject(project.id, projectOpts, project.path, project.port);

        project.pid = pid;
        project.save();

        this._projects[project.id] = {
          process: pid,
          dir: project.path,
          port: project.port,
          state: "running"
        }
      } else {
        //need to check if PID is actually Node-RED
        //current best we can do with the ps node is check if process is node
        this._projects[project.id] = {
          process: project.pid,
          dir: project.path,
          port: project.port,
          state: "running"
        }
      }
    })

    //nothing to expose at the moment
    return {}
  },
   /**
   * Create a new Project
   * @param {string} id - id for the project
   * @param {forge.containers.Options} options - options for the project
   * @return {forge.containers.Project}
   */
  create: async (id, options) => {

    let directory = path.join(this._rootDir, id)
    createUserDirIfNeeded(this._rootDir, id)

    if (options.port && this._usedPorts.contains(port)) {
      // error port in use so set it zero to get the next
      options.port = 0
    }
    var port = options.port || getNextFreePort(this._usedPorts);

    this._usedPorts.push(port);

    let pid = startProject(id, options, directory, port)
    console.log("PID",pid, "port", port, "directory", directory)

    await this._app.db.models.LocalFSProject.create({
      id: id,
      pid: pid,
      path: directory,
      port: port,
      state: "running",
      options: options ? JSON.stringify(options): "{}"
    })

    this._projects[id] = {
      process: pid,
      dir: directory,
      port: port,
      state: "running"
    }

    // proc.unref();

    return Promise.resolve({
      id: id,
      status: "okay",
      url: "http://localhost:" + port,
      meta: {
        port: port
      }
    })
  },
  /**
   * Removes a Project
   * @param {string} id - id of project to remove
   * @return {Object}
   */
  remove: async (id) => {

    let project = await this._app.db.models.LocalFSProject.byId(id);

    if (project) {
      try {
        process.kill(project.pid,'SIGTERM')
      } catch (err) {
        //probably means already stopped
      }

      setTimeout(() => {
        fs.rmSync(project.path,{recursive: true, force: true})
      }, 5000)

      project.destroy()

      delete this._projects[id]

      return Promise.resolve({
        status: "okay"
      })
    } else {
      return Promise.reject({
        err: "project not found"
      })
    }


  },
  /**
    * Retrieves details of a project's container
    * @param {string} id - id of project to query
    * @return {Object}
    */
  details: async (id) => {

    let infoURL = "http://localhost:"+ (this._projects[id].port + 1000) + "/flowforge/info"
    try {
      let info = JSON.parse((await got.get(infoURL)).body)
      return Promise.resolve(info)
    } catch (err) {
      //TODO
      return Promise.resolve()
    }

    // if (this._projects[id]){
    //   let [proc] = await ps({pid:this._projects[id].process})
    //   if (proc) {
    //     this._projects[id].state = "running"
    //   } else {
    //     this._projects[id].state = "stopped"
    //   }
    //   return Promise.resolve(this._projects[id])
    // } else {
    //   return Promise.resolve()
    // }

  },
  /**
   * Returns the settings for the project
   */
  settings: async (id) => {
    let project = await this._app.db.models.LocalFSProject.byId(id);
    let options = JSON.parse(project.options)
    var settings = {}
    if (project) {
      // TODO: some of this options should be centralised into the core model
      settings.projectID = id
      settings.env = options.env
      settings.rootDir = this._rootDir
      settings.userDir = id
      settings.port = project.port
      settings.baseURL = `http://localhost:${project.port}`
      settings.forgeURL = process.env["BASE_URL"]
      settings.clientID = options.clientID
      settings.clientSecret = options.clientSecret
      settings.storageURL = options.storageURL
      settings.projectToken = options.projectToken
      settings.auditURL = options.auditURL
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
    let projects = await this._app.db.models.LocalFSProject.findAll();
    return projects;
  },
  /**
   * Starts a Project's container
   * @param {string} id - id of project to start
   * @return {forge.Status}
   */
  start: async (id) => {

    let project = await this._app.db.models.LocalFSProject.byId(id)

    await got.post("http://localhost:" + (project.port + 1000) + "/flowforge/command",{
      json: {
        cmd: "start"
      }
    })

    // let pid = startProject(id, JSON.parse(project.env), project.path, project.port)

    // project.pid = pid;
    project.state = "starting"
    // project.save()

    return Promise.resolve({status: "okay"})
  },
  /**
   * Stop a Project's container
   * @param {string} id - id of project to stop
   * @return {forge.Status}
   */
  stop: async (id) => {

    let project = await this._app.db.models.LocalFSProject.byId(id)

    await got.post("http://localhost:" + (project.port + 1000) + "/flowforge/command",{
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
   * @param {string} id - id of project to restart
   * @return {forge.Status}
   */
  restart: async (id) => {
    let project = await this._app.db.models.LocalFSProject.byId(id)

    await got.post("http://localhost:" + (project.port + 1000) + "/flowforge/command",{
      json: {
        cmd: "restart"
      }
    })

    return {state: "okay"}
  },

  /**
   * Get a Project's logs
   * @param {string} id - id of project
   * @return {array} logs
   */
  logs: async (id) => {
    let project = await this._app.db.models.LocalFSProject.byId(id)
    let result = await got.get("http://localhost:" + (project.port + 1000) + "/flowforge/logs").json()
    return result;
  }
}
