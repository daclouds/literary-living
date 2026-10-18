import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {installGenerationRoutes} from '../generations.js';
import {buildJobDefinition,createNosanaClient} from '../nosana.js';
import {catalog} from '../catalog.js';
async function setup({uncertain=false}={}){
 const dir=mkdtempSync(path.join(os.tmpdir(),'gpu-test-'));const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('a'),('b');CREATE TABLE rooms(id TEXT PRIMARY KEY,is_public INTEGER);");
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['x-user'])req.user={id:req.headers['x-user']};next();});
 let definition,creates=0,stops=0;const client={inspect:async()=>({vault:'vault'}),create:async({definition:d})=>{definition=d;creates++;if(uncertain)throw new Error('ambiguous network failure');return {id:'provider1'};},start:async()=>{},stop:async()=>{stops++;}};
 const manager=installGenerationRoutes(app,{db,auth:(req,res,next)=>req.user?next():res.status(401).end(),findConcept:id=>catalog.find(c=>c.id===id),data:dir,config:{key:'test-only',callbackUrl:'https://callback.example',client}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(url,{method='GET',body,user,token,raw}={})=>fetch(base+url,{method,headers:{...(user?{'x-user':user}:{}),...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{}),...(raw?{'content-type':'image/png'}:{})},body:raw||(body?JSON.stringify(body):undefined)});
 return {request,db,manager,definition:()=>definition,creates:()=>creates,stops:()=>stops,close:async()=>{manager.close();await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}};
}
async function queued(s,id){for(let i=0;i<50;i++){const r=await (await s.request('/api/generations/'+id,{user:'a'})).json();if(r.job.state!=='submitting')return r.job;await new Promise(r=>setTimeout(r,5));}throw new Error('dispatch did not finish');}
test('authenticated generation, single claim, PNG validation, privacy and idempotent result upload',async()=>{const s=await setup();try{
 const requestId=randomUUID();const body={conceptId:'gatsby',requestId};assert.equal((await s.request('/api/generate',{method:'POST',body})).status,401);
 const submitted=await s.request('/api/generate',{method:'POST',body,user:'a'});assert.equal(submitted.status,202);const {job}=await submitted.json();assert.equal((await queued(s,job.id)).state,'queued');
 assert.equal((await s.request('/api/generate',{method:'POST',body,user:'a'})).status,200);assert.equal(s.creates(),1);assert.equal((await s.request('/api/generations/'+job.id,{user:'b'})).status,404);
 const token=s.definition().ops[0].args.env.LL_JOB_TOKEN;const prefix='/api/worker/jobs/'+job.id;
 assert.equal((await s.request(prefix+'/claim',{method:'POST',token:'wrong'})).status,401);const claim=await s.request(prefix+'/claim',{method:'POST',token});assert.equal(claim.status,200);const input=await claim.json();assert.equal(input.width,1024);assert.equal(input.steps,30);assert.ok(input.prompt.includes('Gatsby'));
 assert.equal((await s.request(prefix+'/claim',{method:'POST',token})).status,409);
 assert.equal((await s.request(prefix+'/image',{method:'PUT',token,raw:Buffer.from('not png')})).status,400);
 const image=await sharp({create:{width:1024,height:768,channels:3,background:'#708060'}}).png().toBuffer();assert.equal((await s.request(prefix+'/image',{method:'PUT',token,raw:image})).status,200);assert.equal((await s.request(prefix+'/image',{method:'PUT',token,raw:image})).status,200);
 const result=(await (await s.request('/api/generations/'+job.id,{user:'a'})).json()).job;assert.equal(result.state,'succeeded');assert.equal((await s.request(result.image)).status,404);assert.equal((await s.request(result.image,{user:'a'})).status,200);assert.equal((await s.request(result.image,{user:'b'})).status,404);
 s.db.prepare('INSERT INTO rooms(id,is_public,generation_id) VALUES(?,?,?)').run('room',1,job.id);assert.equal((await s.request(result.image)).status,200);await s.manager.reconcile();assert.ok(s.stops()>=1);
 }finally{await s.close();}});
test('ambiguous submission is retained without resubmission or a second paid job',async()=>{const s=await setup({uncertain:true});try{const body={conceptId:'anne',requestId:randomUUID()};const {job}=await (await s.request('/api/generate',{method:'POST',body,user:'a'})).json();assert.equal((await queued(s,job.id)).state,'submission_unknown');await s.manager.reconcile();assert.equal(s.creates(),1);assert.equal((await s.request('/api/generate',{method:'POST',body:{...body,requestId:randomUUID()},user:'b'})).status,409);}finally{await s.close();}});
test('Nosana uses documented SIMPLE per-image deployments with capped runtime',async()=>{const calls=[];const client=createNosanaClient({request:async(method,p,body)=>{calls.push({method,p,body});return {id:'test'};}});const definition=buildJobDefinition({callbackUrl:'https://callback.example',jobId:randomUUID(),token:'scoped-token'});await client.create({jobId:'request',definition,source:{vault:'existing'}});const body=calls[0].body;assert.equal(calls[0].p,'/deployments/create');assert.equal(body.strategy,'SIMPLE');assert.equal(body.timeout,20);assert.equal(body.replicas,1);assert.equal(body.autostart,false);assert.equal(body.vault,'existing');assert.equal(definition.ops[0].args.gpu,true);assert.equal(definition.ops[0].args.restart_policy,'no');assert.ok(!JSON.stringify(definition).includes('NOSANA_API_KEY'));assert.throws(()=>buildJobDefinition({callbackUrl:'http://localhost',jobId:'x',token:'x'}));});

test('API-key authentication uses the documented client-manager proxy rather than wallet-only deployment manager',async()=>{
 const calls=[];const client=createNosanaClient({key:'test-credential',http:async options=>{calls.push(options);return {data:{id:'deployment'}};}});
 await client.inspect('deployment');assert.equal(calls[0].url,'https://client-manager.k8s.prd.nosana.com/deployments/deployment');assert.equal(calls[0].headers.Authorization,'Bearer test-credential');assert.equal(calls[0].maxRedirects,0);
});
