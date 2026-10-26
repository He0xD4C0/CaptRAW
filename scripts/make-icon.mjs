import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
mkdirSync('build/icon.iconset',{recursive:true});
execFileSync('swift',['scripts/make-icon.swift','build/icon-1024.png']);
for(const size of [16,32,128,256,512]){
 for(const density of [1,2])execFileSync('sips',['-z',String(size*density),String(size*density),'build/icon-1024.png','--out',`build/icon.iconset/icon_${size}x${size}${density===2?'@2x':''}.png`],{stdio:'ignore'});
}
execFileSync('iconutil',['-c','icns','build/icon.iconset','-o','build/icon.icns']);
