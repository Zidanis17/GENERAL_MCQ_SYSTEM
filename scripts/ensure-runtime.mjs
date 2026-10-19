import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const electronRoot=resolve('node_modules/electron')
const {version}=JSON.parse(await readFile(resolve(electronRoot,'package.json'),'utf8'))
try {
  if((await readFile(resolve(electronRoot,'dist/version'),'utf8')).trim().replace(/^v/,'')===version){
    await readFile(resolve(electronRoot,'dist/electron.exe'))
    await writeFile(resolve(electronRoot,'path.txt'),'electron.exe')
    console.log(`Electron ${version} is ready.`)
    process.exit(0)
  }
} catch {}
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('This packaging helper targets Windows x64.')
const artifact=`electron-v${version}-win32-x64.zip`
const cache=resolve('.cache')
const archive=resolve(cache,artifact)
const checksums=JSON.parse(await readFile(resolve(electronRoot,'checksums.json'),'utf8'))
const expected=checksums[artifact]
if(typeof expected!=='string')throw new Error('No official checksum is available for this Electron runtime.')
await mkdir(cache,{recursive:true})
const valid=async()=>{try{return createHash('sha256').update(await readFile(archive)).digest('hex')===expected}catch{return false}}
if(!await valid()){
  console.log(`Downloading the official Electron ${version} Windows runtime…`)
  execFileSync('curl.exe',['--fail','--silent','--show-error','--location','--retry','2','--connect-timeout','20','--max-time','300','--output',archive,`https://github.com/electron/electron/releases/download/v${version}/${artifact}`],{stdio:'inherit',windowsHide:true})
}
if(!await valid())throw new Error('Electron archive checksum did not match the official package. Build stopped.')
console.log('Checksum verified. Extracting the runtime…')
execFileSync('powershell.exe',['-NoProfile','-Command','Expand-Archive -LiteralPath $env:MCQ_ARCHIVE_PATH -DestinationPath $env:MCQ_EXTRACT_PATH -Force'],{stdio:'inherit',windowsHide:true,env:{...process.env,MCQ_ARCHIVE_PATH:archive,MCQ_EXTRACT_PATH:resolve(electronRoot,'dist')}})
await writeFile(resolve(electronRoot,'path.txt'),'electron.exe')
console.log(`Electron ${version} is ready.`)
