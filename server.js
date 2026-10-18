import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalog,publicConcept} from './catalog.js';
import {curatedPair,verifyPair,verifiedConcept} from './literature.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.DATA_DIR||path.join(root,'data');mkdirSync(data,{recursive:true});
const db=new DatabaseSync(path.join(data,'living.sqlite'));db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS concepts(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),concept TEXT NOT NULL,title TEXT NOT NULL,is_public INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
`);
export const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'});next();});
app.use(express.json({limit:'16kb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'다른 사이트에서의 요청은 허용하지 않습니다.'});next();});
function hash(password,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(password,salt,64).toString('hex');}
function verify(password,stored){const [salt,key]=stored.split(':');return timingSafeEqual(Buffer.from(hash(password,salt).split(':')[1],'hex'),Buffer.from(key,'hex'));}
function token(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('ll_session='))?.slice(11);}
app.use('/api',(req,res,next)=>{const t=token(req);if(t)req.user=db.prepare('SELECT u.id,u.email,u.name FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(t,Date.now());next();});
const attempts=new Map();function limit(req,res,next){const key=req.ip;const now=Date.now();const entry=attempts.get(key);if(!entry||entry.until<now){attempts.set(key,{count:1,until:now+600000});if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);}else if(++entry.count>30)return res.status(429).json({error:'요청이 많습니다. 잠시 뒤 다시 시도해 주세요.'});next();}
function auth(req,res,next){if(!req.user)return res.status(401).json({error:'로그인이 필요합니다.'});next();}
function session(req,res,user){const t=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t,user.id,Date.now()+7*86400000);res.cookie('ll_session',t,{httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:7*86400000,path:'/'});return {id:user.id,name:user.name,email:user.email};}
app.get('/api/health',(req,res)=>res.json({ok:db.prepare('SELECT 1 AS ok').get().ok===1,generation:'not_configured',storage:'sqlite',mode:'curated-preview'}));
app.get('/api/catalog',(req,res)=>res.json(catalog.map(publicConcept)));
app.get('/api/me',(req,res)=>res.json({user:req.user||null}));
app.post('/api/auth/register',limit,(req,res)=>{const {email,password,name}=req.body||{};if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||typeof password!=='string'||password.length<10||password.length>128||typeof name!=='string'||!name.trim()||name.length>40)return res.status(400).json({error:'이름, 유효한 이메일, 10~128자의 비밀번호를 입력해 주세요.'});const user={id:randomUUID(),email:email.trim().toLowerCase(),name:name.trim()};try{db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id,user.email,user.name,hash(password));}catch(e){if(String(e).includes('UNIQUE'))return res.status(409).json({error:'이미 등록된 이메일입니다.'});throw e;}res.status(201).json({user:session(req,res,user)});});
app.post('/api/auth/login',limit,(req,res)=>{const {email,password}=req.body||{};if(typeof email!=='string'||typeof password!=='string'||password.length>128)return res.status(400).json({error:'이메일과 비밀번호를 확인해 주세요.'});const user=db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);const valid=verify(password,user?.password||dummy);if(!user||!valid)return res.status(401).json({error:'이메일 또는 비밀번호가 일치하지 않습니다.'});res.json({user:session(req,res,user)});});
app.post('/api/auth/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(token(req)||'');res.clearCookie('ll_session',{path:'/'});res.json({ok:true});});
app.locals.verifyPair=verifyPair;
function findConcept(id){return catalog.find(c=>c.id===id)||JSON.parse(db.prepare('SELECT payload FROM concepts WHERE id=?').get(id)?.payload||'null');}
app.post('/api/design',limit,async(req,res)=>{
 const {book,character}=req.body||{};
 if(typeof book!=='string'||typeof character!=='string'||!book.trim()||!character.trim()||book.length>200||character.length>120)return res.status(400).json({error:'책 제목(200자 이내)과 등장인물(120자 이내)을 각각 입력해 주세요.'});
 let c=curatedPair(book.trim(),character.trim());
 if(!c){try{const verified=await app.locals.verifyPair(book.trim(),character.trim());c=verifiedConcept(verified);db.prepare('INSERT INTO concepts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(c.id,JSON.stringify(c));}catch(e){return res.status(e.status||503).json({error:e.message});}}
 res.json({concept:publicConcept(c),mode:'curated-preview',notice:c.isGenericDemo?'작품·인물 관계를 확인했습니다. 이미지는 공통 데모이며 해당 인물에 맞춰 생성한 결과가 아닙니다.':'사전 제작된 AI 데모 이미지입니다. Nosana 이미지 생성은 아직 연결되지 않았습니다.'});
});
app.post('/api/generate',auth,(req,res)=>res.status(503).json({error:'Nosana 작업 제출·결제·결과 저장 설정이 필요합니다. 아직 GPU 작업이 제출되거나 과금되지 않았습니다.',code:'GENERATION_NOT_CONFIGURED'}));
function roomView(r){const c=findConcept(r.concept);return {...publicConcept(c),id:r.id,conceptId:c.id,title:r.title,isPublic:!!r.is_public,createdAt:r.created_at,owner:r.name||reqOwner(r),isExample:false};}
function reqOwner(r){return '나의 공간';}
app.get('/api/rooms',auth,(req,res)=>res.json(db.prepare('SELECT * FROM rooms WHERE user_id=? ORDER BY created_at DESC').all(req.user.id).map(roomView)));
app.post('/api/rooms',auth,(req,res)=>{const {conceptId}=req.body||{};const c=typeof conceptId==='string'?findConcept(conceptId):null;if(!c)return res.status(400).json({error:'유효한 콘셉트가 아닙니다.'});const id=randomUUID();db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?,?)').run(id,req.user.id,c.id,c.title,0,new Date().toISOString());res.status(201).json({room:roomView(db.prepare('SELECT * FROM rooms WHERE id=?').get(id))});});
app.patch('/api/rooms/:id',auth,(req,res)=>{const room=db.prepare('SELECT * FROM rooms WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!room)return res.status(404).json({error:'방을 찾을 수 없습니다.'});if(typeof req.body?.isPublic!=='boolean')return res.status(400).json({error:'공개 여부가 필요합니다.'});db.prepare('UPDATE rooms SET is_public=? WHERE id=?').run(Number(req.body.isPublic),room.id);res.json({ok:true});});
app.delete('/api/rooms/:id',auth,(req,res)=>{const r=db.prepare('DELETE FROM rooms WHERE id=? AND user_id=?').run(req.params.id,req.user.id);if(!r.changes)return res.status(404).json({error:'방을 찾을 수 없습니다.'});res.json({ok:true});});
app.get('/api/gallery',(req,res)=>res.json({rooms:db.prepare('SELECT r.*,u.name FROM rooms r JOIN users u ON u.id=r.user_id WHERE is_public=1 ORDER BY created_at DESC LIMIT 60').all().map(roomView),examples:catalog.map(c=>({...publicConcept(c),isExample:true,owner:'Literary Living'}))}));
app.use(express.static(path.join(root,'dist')));
app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));
app.use((error,req,res,next)=>{console.error(error.name,error.code||'');res.status(error.status===400?400:500).json({error:error.status===400?'잘못된 요청입니다.':'요청 처리 중 문제가 발생했습니다.'});});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Literary Living listening on port '+(process.env.PORT||3000)));
