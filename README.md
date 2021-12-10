# Flowforge LocalFS Driver

This will start/stop/monitor Node-RED instances and build separate useDirs for each instance

## Configure

The following environment variables (in the `.env` file) configure this driver

 - CONTAINER_DRIVER=localfs
 - LOCALFS_ROOT=<path/to/store/project/userDirs>
 - LOCALFS_START_PORT=7880
 - LOCALFS_NODE_PATH=<path/to/node/binary> (not required, but useful with nvm)
