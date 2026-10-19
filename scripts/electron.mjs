import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Some IDEs inherit this flag from their own Electron host. It must not turn
// this application's desktop runtime into a plain Node.js process.
const env={...process.env}
delete env.ELECTRON_RUN_AS_NODE
const cli=fileURLToPath(new URL('../node_modules/electron-vite/bin/electron-vite.js',import.meta.url))
const child=spawn(process.execPath,[cli,...process.argv.slice(2)],{stdio:'inherit',env,windowsHide:true})
child.on('error',(error)=>{console.error(error.message);process.exitCode=1})
child.on('exit',(code)=>{process.exitCode=code??0})
process.on('SIGINT',()=>child.kill('SIGINT'))
process.on('SIGTERM',()=>child.kill('SIGTERM'))
