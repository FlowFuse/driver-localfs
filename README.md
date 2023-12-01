# FlowFuse LocalFS Driver

This will start/stop/monitor Node-RED instances and build separate useDirs for each instance

## Configure

In the `flowforge.yml` file the following options can be set under the `drive.options` section

```yaml
...
driver:
  type: localfs
  options:
    start_port: 12080
    privateCA: /full/path/to/chain.pem
```

 - `start_port` Port number to start from when creating Instances (default: 12080)
 - `privateCA` is a fully qaulified path to a pem file containing trusted CA cert chain (default: not set)

## Node-RED Versions for Stacks

To install copies of different versions of Node-RED for use by Project Stacks do the following:

Assuming you wish to install Node-RED v2.2.2

- In the `var` directory create a directory called `stacks`
- In the `var/stacks` directory create a directory called `2.2.2`
- in the `var/stacks/2.2.2` directory run `npm install --prefix . node-red@2.2.2`

In the FlowFuse Admin settings create a Stack with the Node-RED version `2.2.2`
