# Flowforge LocalFS Driver

This will start/stop/monitor Node-RED instances and build separate useDirs for each instance

## Configure

The following environment variables (in the `.env` file) configure this driver

 - CONTAINER_DRIVER=localfs
 - LOCALFS_ROOT=<path/to/store/project/userDirs>
 - LOCALFS_START_PORT=12080
 - LOCALFS_NODE_PATH=<path/to/node/binary> (not required, but useful with nvm)

## Node-RED Versions for Stacks

To install copies of different versions of Node-RED for use by Project Stacks do the following:

Assuming you wish to install Node-RED v2.2.2

- In the `var` directory create a directory called `stacks`
- In the `var/stacks` directory create a directory called `2.2.2`
- in the `var/stacks/2.2.2` directory run `npm install --prefix . node-red@2.2.2`

In the FlowForge Admin settings create a Stack with the Node-RED version `2.2.2`