import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

// Code-drawn native icon: a quiet blue tile, a page, and a check mark.
const size = 256
const pixels = Buffer.alloc(size * (size * 4 + 1))
function segmentDistance(x, y, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)))
  return Math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay))
}
function rounded(x,y,l,t,r,b,radius) {
  const dx = Math.max(l+radius-x,0,x-(r-radius)), dy = Math.max(t+radius-y,0,y-(b-radius))
  return x>=l && x<=r && y>=t && y<=b && dx*dx+dy*dy<=radius*radius
}
for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
  let color=[0,0,0,0]
  if (rounded(x,y,8,8,248,248,52)) color=[53,104,212,255]
  if (rounded(x,y,67,48,190,212,23) && !rounded(x,y,77,58,180,202,14)) color=[255,255,255,255]
  if (segmentDistance(x,y,96,130,122,155)<7 || segmentDistance(x,y,122,155,162,108)<7) color=[255,255,255,255]
  const i=y*(size*4+1)+1+x*4
  for(let c=0;c<4;c++) pixels[i+c]=color[c]
}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
function chunk(type,data){const t=Buffer.from(type);const body=Buffer.concat([t,data]);let c=0xffffffff;for(const b of body)c=crcTable[(c^b)&255]^(c>>>8);const n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(data.length);crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([n,body,crc])}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18)
await mkdir('build',{recursive:true})
await writeFile('build/icon.png',png)
await writeFile('build/icon.ico',Buffer.concat([ico,png]))
