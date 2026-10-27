import {build,context} from 'esbuild';
import {isBuiltin} from 'node:module';
import {writeFileSync} from 'node:fs';

const options={
  entryPoints:['electron/main.ts','electron/preload.ts'],bundle:true,
  platform:'node',format:'cjs',external:['electron'],outdir:'dist/electron',
  outExtension:{'.js':'.cjs'},metafile:true,
  plugins:[{name:'runtime-dependencies',setup(builder){builder.onEnd(result=>{
    if(result.errors.length)return;
    const imports=Object.values(result.metafile.outputs).flatMap(output=>output.imports).filter(item=>item.external);
    for(const item of imports)if(item.path!=='electron'&&!isBuiltin(item.path))throw new Error('Unbundled runtime dependency: '+item.path);
    writeFileSync('dist/electron/metafile.json',JSON.stringify(result.metafile,null,2)+'\n');
    if(process.argv.includes('--watch'))console.log('Electron 编译完成；主进程或共享服务更新后，请保存编辑并手动重启应用。');
  });}}]
};
if(process.argv.includes('--watch'))await (await context(options)).watch();
else await build(options);
