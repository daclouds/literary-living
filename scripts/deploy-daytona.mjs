import {Daytona} from '@daytona/sdk';
import {ensureNode} from './ensure-daytona-node.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.DAYTONA_API_KEY)throw new Error('DAYTONA_API_KEY must be provided through secure environment settings.');
if(!process.env.DAYTONA_SANDBOX)throw new Error('Set DAYTONA_SANDBOX to your existing sandbox ID or name.');
const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
const daytona=new Daytona();
const sandbox=await daytona.get(process.env.DAYTONA_SANDBOX);
if(sandbox.state!=='started')await sandbox.start(90);
await ensureNode(sandbox);
const runtime='export PATH="$HOME/.local/literary-node/bin:$PATH"; ';
const check=await sandbox.process.executeCommand(runtime+'node --version');
if(check.exitCode!==0||!/^v(2[4-9]|[3-9]\d)\./.test(check.result.trim()))throw new Error('Sandbox needs Node.js 24+ for built-in SQLite. No files were replaced.');
execFileSync('npm',['run','build'],{cwd:root,stdio:'inherit'});
const temp=mkdtempSync(path.join(tmpdir(),'living-deploy-'));
try{
 const archive=path.join(temp,'release.tar.gz');
 execFileSync('tar',['-czf',archive,'package.json','package-lock.json','server.js','catalog.js','literature.js','dist'],{cwd:root});
 const buffer=readFileSync(archive);const checksum=createHash('sha256').update(buffer).digest('hex');
 const release='release-'+Date.now()+'-'+randomBytes(3).toString('hex');
 // Isolated release directory: never overwrite existing application or user data.
 const home=await sandbox.process.executeCommand('pwd');if(home.exitCode!==0)throw new Error('Cannot locate sandbox working directory.');
 const base=home.result.trim()+'/literary-living';const remote=base+'/'+release;
 async function run(command,timeout=120){const r=await sandbox.process.executeCommand(runtime+command,undefined,undefined,timeout);if(r.exitCode!==0)throw new Error('Remote command failed: '+r.result);return r;}
 await run('mkdir -p '+q(remote)+' '+q(base+'/data'));
 await sandbox.fs.uploadFile(buffer,remote+'/release.tar.gz');
 await run('cd '+q(remote)+' && printf %s '+q(checksum+'  release.tar.gz\n')+' | sha256sum -c - && tar -xzf release.tar.gz && npm ci --omit=dev',300);
 // Only replace our own previously deployed server; leave unrelated services untouched.
 const stopOwned=`const fs=require('fs');const base=${JSON.stringify(base)};const matches=[];for(const pid of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const cwd=fs.readlinkSync('/proc/'+pid+'/cwd');const cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0').filter(Boolean);if(cwd.startsWith(base+'/release-')&&cmd.at(-1)==='server.js'&&/node$/.test(cmd[0]))matches.push(Number(pid));}catch{}}if(matches.length>1)throw new Error('Multiple managed app processes; inspect before replacing');for(const pid of matches)process.kill(pid,'SIGTERM');`;
 await run('node -e '+q(stopOwned));
 await run('node -e '+q("(async()=>{for(let i=0;i<20;i++){const ok=await new Promise(r=>{const s=require('net').createServer();s.once('error',()=>r(false));s.listen(3000,'0.0.0.0',()=>s.close(()=>r(true)));});if(ok)return;await new Promise(r=>setTimeout(r,500));}process.exit(1)})()"));
 const sessionId='literary-living-'+Date.now();await sandbox.process.createSession(sessionId);
 await sandbox.process.executeSessionCommand(sessionId,{command:runtime+'cd '+q(remote)+' && NODE_ENV=production PORT=3000 DATA_DIR='+q(base+'/data')+' node server.js',runAsync:true});
 await run("node -e "+q("(async()=>{for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:3000/api/health');const d=await r.json();if(r.ok&&d.ok)process.exit(0);}catch{}await new Promise(r=>setTimeout(r,1000));}process.exit(1)})()"),45);
 const signed=await sandbox.getSignedPreviewUrl(3000,86400);
 // A signed link exposes only the intended preview, rather than making every sandbox port public.
 const url=signed.url;if(!url)throw new Error('Daytona did not return a signed preview URL.');
 let externalVerified=false;
 try{const html=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',url],{encoding:'utf8',stdio:['ignore','pipe','pipe']});externalVerified=html.includes('Literary Living');}catch{console.warn('App health passed inside sandbox; external verification is blocked or unavailable. Check preview access separately.');}
 console.log(JSON.stringify({status:'deployed',url,externalVerified,expiresInSeconds:86400,sessionId,releaseDirectory:remote,databaseDirectory:base+'/data',generation:'not_configured'},null,2));
}finally{rmSync(temp,{recursive:true,force:true});}
