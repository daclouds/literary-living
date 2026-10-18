import express from 'express';
import sharp from 'sharp';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import path from 'node:path';
import {buildJobDefinition,createNosanaClient,SOURCE_DEPLOYMENT} from './nosana.js';
const digest=value=>createHash('sha256').update(value).digest();
const active=['submitting','queued','running','submission_unknown'];
export function installGenerationRoutes(app,{db,auth,findConcept,data,config={}}){
 const settings={key:process.env.NOSANA_API_KEY,callbackUrl:process.env.LL_PUBLIC_URL,callbackExpires:Number(process.env.LL_PUBLIC_URL_EXPIRES)||0,source:process.env.NOSANA_DEPLOYMENT_ID||SOURCE_DEPLOYMENT,model:'stabilityai/stable-diffusion-xl-base-1.0',revision:process.env.NOSANA_MODEL_REVISION||'main',...config};
 const client=config.client||createNosanaClient({key:settings.key});
 db.exec(`CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),concept TEXT NOT NULL,request_key TEXT NOT NULL,token_hash TEXT NOT NULL,state TEXT NOT NULL,provider_id TEXT,error TEXT,seed INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,stop_pending INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,request_key));
 CREATE UNIQUE INDEX IF NOT EXISTS single_gpu_generation ON generations((1)) WHERE state IN ('submitting','queued','running','submission_unknown') OR stop_pending=1;`);
 if(!db.prepare('PRAGMA table_info(rooms)').all().some(c=>c.name==='generation_id'))db.exec('ALTER TABLE rooms ADD COLUMN generation_id TEXT');
 const imageDir=path.join(data,'generated');mkdirSync(imageDir,{recursive:true});
 const configured=()=>!!settings.key&&/^https:\/\//.test(settings.callbackUrl||'')&&(!settings.callbackExpires||settings.callbackExpires>Date.now()+25*60000);
 const view=r=>({id:r.id,conceptId:r.concept,state:r.state,error:r.error,createdAt:new Date(r.created_at).toISOString(),image:r.state==='succeeded'?'/api/generated/'+r.id:null});
 const get=id=>db.prepare('SELECT * FROM generations WHERE id=?').get(id);
 const set=(id,state,error=null,stop=0)=>db.prepare('UPDATE generations SET state=?,error=?,updated_at=?,stop_pending=? WHERE id=?').run(state,error,Date.now(),stop,id);
 function workerAuth(req,res,next){const job=get(req.params.id);const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!job||!bearer||!timingSafeEqual(digest(bearer),Buffer.from(job.token_hash,'hex')))return res.status(401).json({error:'Unauthorized worker'});if(Date.now()-job.created_at>30*60000)return res.status(410).json({error:'Job capability expired'});req.generation=job;next();}
 let reconciling=false;
 async function reconcile(){if(reconciling||!settings.key)return;reconciling=true;try{const rows=db.prepare("SELECT * FROM generations WHERE stop_pending=1 OR state IN ('queued','running','submitting','submission_unknown')").all();for(const row of rows){try{if(Date.now()-row.created_at>25*60000&&active.includes(row.state)){if(!row.provider_id){set(row.id,'submission_unknown','작업 제출 결과 확인이 필요합니다. 자동으로 재제출하지 않습니다.');continue;}set(row.id,'failed','생성 제한 시간을 초과했습니다.',1);row.stop_pending=1;}if(row.stop_pending&&row.provider_id){await client.stop(row.provider_id);db.prepare('UPDATE generations SET stop_pending=0 WHERE id=?').run(row.id);}}catch{ /* Keep cleanup pending and retry; no new GPU work while unresolved. */ }}}finally{reconciling=false;}}
 async function dispatch(job,token){let providerId,createAttempted=false;try{const source=await client.inspect(settings.source);const definition=buildJobDefinition({callbackUrl:settings.callbackUrl,jobId:job.id,token});createAttempted=true;const deployment=await client.create({jobId:job.id,definition,source});if(!deployment?.id)throw new Error('Invalid provider response');providerId=deployment.id;db.prepare("UPDATE generations SET provider_id=?,state='queued',updated_at=? WHERE id=?").run(providerId,Date.now(),job.id);await client.start(providerId);}catch(e){if(providerId)set(job.id,'failed','GPU 작업을 시작하지 못했습니다. 설정 또는 잔액을 확인해 주세요.',1);else if(!createAttempted||e.code==='NOSANA_AUTH_FAILED'||e.code==='NOSANA_INSUFFICIENT_FUNDS')set(job.id,'failed','Nosana 인증 또는 결제 잔액을 확인해 주세요.');else set(job.id,'submission_unknown','작업 제출 여부를 확인하지 못했습니다. 중복 과금을 막기 위해 자동 재시도하지 않습니다.');}finally{void reconcile();}}
 app.get('/api/generations',auth,(req,res)=>res.json({configured:configured(),jobs:db.prepare('SELECT * FROM generations WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.user.id).map(view)}));
 app.get('/api/generations/:id',auth,(req,res)=>{const job=get(req.params.id);if(!job||job.user_id!==req.user.id)return res.status(404).json({error:'생성 작업을 찾을 수 없습니다.'});res.json({job:view(job),concept:findConcept(job.concept)});});
 app.post('/api/generate',auth,(req,res)=>{
  const {conceptId,requestId}=req.body||{};
  if(!configured())return res.status(503).json({code:'GENERATION_NOT_CONFIGURED',error:'Nosana 인증과 결과 수신 주소 설정이 필요합니다. 아직 GPU 작업이 제출되거나 과금되지 않았습니다.'});
  if(typeof conceptId!=='string'||!findConcept(conceptId)||typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId))return res.status(400).json({error:'검증된 콘셉트와 요청 식별자가 필요합니다.'});
  const previous=db.prepare('SELECT * FROM generations WHERE user_id=? AND request_key=?').get(req.user.id,requestId);if(previous)return res.json({job:view(previous)});
  const job={id:randomUUID(),user_id:req.user.id,concept:conceptId,state:'submitting',created_at:Date.now(),seed:randomBytes(4).readUInt32BE()};const token=randomBytes(32).toString('base64url');
  try{db.prepare('INSERT INTO generations(id,user_id,concept,request_key,token_hash,state,seed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(job.id,job.user_id,job.concept,requestId,digest(token).toString('hex'),job.state,job.seed,job.created_at,job.created_at);}catch(e){if(String(e).includes('UNIQUE'))return res.status(409).json({error:'다른 이미지 생성 작업을 처리 중입니다. 완료 후 다시 시도해 주세요.'});throw e;}
  res.status(202).json({job:view(job)});void dispatch(job,token);
 });
 app.post('/api/worker/jobs/:id/claim',workerAuth,(req,res)=>{
  const job=req.generation;const updated=db.prepare("UPDATE generations SET state='running',updated_at=? WHERE id=? AND state='queued'").run(Date.now(),job.id);if(!updated.changes)return res.status(409).json({error:'Job already claimed or terminal'});
  const concept=findConcept(job.concept);res.json({prompt:concept.prompt||`Hyper realistic architectural interior photograph of a room inspired by ${concept.character} from the book ${concept.original||concept.book}. Thoughtful character-inspired color palette, realistic wood, linen and metal materials, natural cinematic daylight, wide angle eye level, physically plausible furniture, no people, no text.`,negativePrompt:'text, watermark, people, low quality, distorted furniture, impossible geometry, oversaturated, blurry',model:settings.model,revision:settings.revision,width:1024,height:768,steps:30,seed:job.seed});
 });
 app.put('/api/worker/jobs/:id/image',workerAuth,express.raw({type:'image/png',limit:'16mb'}),async(req,res)=>{
  const job=req.generation;if(job.state==='succeeded')return res.json({ok:true});if(job.state!=='running')return res.status(409).json({error:'Job is not running'});
  if(!Buffer.isBuffer(req.body)||!req.body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return res.status(400).json({error:'PNG image required'});
  let buffer;try{const image=sharp(req.body,{limitInputPixels:2*1024*1024});const info=await image.metadata();if(info.width!==1024||info.height!==768||info.pages>1)throw new Error('Unexpected dimensions');buffer=await image.png().toBuffer();}catch{return res.status(400).json({error:'Invalid image or dimensions'});}
  // A timeout/failure may have won while image decoding was in progress.
  if(get(job.id).state!=='running')return res.status(409).json({error:'Job no longer running'});
  const temp=path.join(imageDir,job.id+'.tmp');writeFileSync(temp,buffer,{mode:0o600});renameSync(temp,path.join(imageDir,job.id+'.png'));set(job.id,'succeeded',null,1);res.json({ok:true});void reconcile();
 });
 app.post('/api/worker/jobs/:id/fail',workerAuth,(req,res)=>{const job=req.generation;if(active.includes(job.state))set(job.id,'failed','GPU 이미지 생성에 실패했습니다.',job.provider_id?1:0);res.json({ok:true});void reconcile();});
 app.get('/api/generated/:id',(req,res)=>{const job=get(req.params.id);if(!job||job.state!=='succeeded')return res.status(404).end();const published=db.prepare('SELECT 1 FROM rooms WHERE generation_id=? AND is_public=1').get(job.id);if(job.user_id!==req.user?.id&&!published)return res.status(404).end();res.set('Cache-Control','private, no-store');res.type('png').sendFile(path.resolve(imageDir,job.id+'.png'));});
 const timer=setInterval(()=>void reconcile(),30000);timer.unref();void reconcile();
 return {configured,view,get,reconcile,close:()=>clearInterval(timer),imageDir,settings};
}
