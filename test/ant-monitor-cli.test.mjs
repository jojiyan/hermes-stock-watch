import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

for(const verifyOnly of [true,false])test(`catalog CLI separates completed execution from unverified markets (verifyOnly=${verifyOnly})`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ant-cli-'));
 try{
  await mkdir(join(dir,'src'));
  for(const file of ['ant-catalog-monitor.mjs','ant-notify.mjs','ant-state-store.mjs'])
   await copyFile(new URL('../src/'+file,import.meta.url),join(dir,'src',file));
  await writeFile(join(dir,'src/ant-catalog-check.mjs'),`export async function checkCatalogMarkets(state,key,checkedAt){
   if(state.version!==3)throw new Error('version downgraded');
   return {state:{...state,markets:{US:{status:'unknown'},CA:{status:'ok'}}},
    report:{checkedAt,healthy:false,executionStatus:'completed',verificationStatus:'unverified'},alerts:[]};
  }`);
  const original=JSON.stringify({version:3,markets:{}});
  await writeFile(join(dir,'ant-state.json'),original);
  const output=join(dir,'output');
  const result=spawnSync(process.execPath,[join(dir,'src/ant-catalog-monitor.mjs')],{encoding:'utf8',
   env:{...process.env,SCRAPINGANT_API_KEY:'test',GITHUB_TOKEN:'test',GITHUB_REPOSITORY:'test/repo',GITHUB_REPOSITORY_OWNER:'test',VERIFY_ONLY:String(verifyOnly),GITHUB_OUTPUT:output}});
  assert.equal(result.status,0,result.stderr);
  const outputs=await readFile(output,'utf8');
  assert.match(outputs,/execution_status=completed/);assert.match(outputs,/verification_status=unverified/);
  assert.ok(outputs.includes(`state_written=${!verifyOnly}`));
  const saved=await readFile(join(dir,'ant-state.json'),'utf8');
  if(verifyOnly)assert.equal(saved,original);
  else {assert.equal(JSON.parse(saved).version,3);assert.equal(JSON.parse(saved).markets.US.status,'unknown');}
 }finally{await rm(dir,{recursive:true,force:true});}
});
