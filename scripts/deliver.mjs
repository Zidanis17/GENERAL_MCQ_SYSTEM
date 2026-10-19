import { execFileSync } from 'node:child_process'
import { access, copyFile, mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const {version}=JSON.parse(await readFile('package.json','utf8'))
const desktop=execFileSync('powershell.exe',['-NoProfile','-Command',"[Environment]::GetFolderPath('Desktop')"],{encoding:'utf8',windowsHide:true}).trim()
if(!desktop)throw new Error('Windows did not return a Desktop folder.')
const destination=resolve(desktop,'MCQ Studio')
const files=[
  [`release/MCQ-Studio-Portable-${version}.exe`,`MCQ Studio.exe`],
  [`release/MCQ-Studio-Setup-${version}.exe`,`MCQ Studio Setup.exe`],
  ['examples/general-knowledge.json','Example question bank.json'],
  ['question-bank.schema.json','question-bank.schema.json'],
  ['USAGE.md','Start here.md'],
  ['FORMAT.md','File format.md'],
  ['UPDATES.md','Publish updates.md']
]
for(const [source]of files)await access(source)
await mkdir(destination,{recursive:true})
for(const [source,name]of files)await copyFile(source,join(destination,name))
console.log(`Ready to use: ${join(destination,'MCQ Studio.exe')}`)
