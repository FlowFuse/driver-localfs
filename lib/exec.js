const childProcess = require('child_process')

module.exports = {
    run: function (command, args, options) {
        return new Promise((resolve, reject) => {
            let stderr = ''
            let stdout = ''

            const child = childProcess.spawn(command, args, options)
            child.stdout.on('data', (data) => {
                const str = '' + data
                stdout += str
            })
            child.stderr.on('data', (data) => {
                const str = '' + data
                stderr += str
            })
            child.on('error', (err) => {
                stderr = err.toString()
            })
            child.on('close', (code) => {
                const result = {
                    code: code,
                    stdout: stdout,
                    stderr: stderr
                }
                if (code === 0) {
                    resolve(result)
                } else {
                    reject(result)
                }
            })
        })
    }
}
