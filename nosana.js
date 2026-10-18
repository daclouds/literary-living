import axios from 'axios';
import {readFileSync} from 'node:fs';
export const NOSANA_MANAGER='https://deployment-manager.k8s.prd.nos.ci';
export const SOURCE_DEPLOYMENT='Aa2BjYJuDjS9vbN5rpDrJM2qGF9Ak6fz9esSuFESRcsa';
export const GPU_IMAGE='pytorch/pytorch@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee';
export class NosanaError extends Error{constructor(code,status=503){super(code);this.code=code;this.status=status;}}
export function buildJobDefinition({callbackUrl,jobId,token,image=GPU_IMAGE,setupOnly=false}){
 const url=new URL(callbackUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Public HTTPS callback origin required');
 if(!/^[a-zA-Z0-9-]+$/.test(jobId)||!token)throw new Error('Job ID and scoped token required');
 const source=readFileSync(new URL('./gpu/worker.py',import.meta.url));
 const requirements=readFileSync(new URL('./gpu/requirements.txt',import.meta.url),'utf8').trim().split('\n').filter(Boolean);
 return {version:'0.1',type:'container',ops:[{type:'container/run',id:'generate-room',args:{image,gpu:true,entrypoint:['/bin/bash','-lc'],cmd:[`set -euo pipefail; python -m pip install --no-cache-dir ${requirements.join(' ')}; python -c 'import os,base64; exec(compile(base64.b64decode(os.environ["LL_WORKER_CODE_B64"]),"worker.py","exec"))'`],env:{LL_CALLBACK_URL:url.origin,LL_JOB_ID:jobId,LL_JOB_TOKEN:token,LL_WORKER_CODE_B64:source.toString('base64'),PYTHONUNBUFFERED:'1',HF_HUB_DISABLE_TELEMETRY:'1',...(setupOnly?{LL_SETUP_ONLY:'1'}:{})},restart_policy:'no'},execution:{timeout:1200}}],meta:{trigger:'literary-living',mode:'one-image-per-job'}};
}
export function createNosanaClient({key=process.env.NOSANA_API_KEY,request}={}){
 const transport=request||(async(method,path,body)=>{try{const r=await axios({method,url:NOSANA_MANAGER+path,data:body,headers:{Authorization:'Bearer '+key},timeout:30000,maxRedirects:0});return r.data;}catch(e){throw new NosanaError(e.response?.status===401||e.response?.status===403?'NOSANA_AUTH_FAILED':e.response?.status===402?'NOSANA_INSUFFICIENT_FUNDS':e.response?.status===409?'NOSANA_CONFLICT':'NOSANA_REQUEST_FAILED',e.response?.status===409?409:503);}});
 return {
  async inspect(id){if(!/^[A-Za-z0-9]+$/.test(id))throw new Error('Invalid deployment ID');return transport('GET','/deployments/'+id);},
  async revise(id,definition){return transport('POST','/deployments/'+id+'/create-revision',definition);},
  async create({jobId,definition,source}){
   // A fresh SIMPLE deployment is created per image; the source stays untouched.
   return transport('POST','/deployments/create',{idempotency_key:'literary-living-'+jobId,name:'literary-living-'+jobId,replicas:1,timeout:20,strategy:'SIMPLE',autostart:false,...(source.vault?{vault:source.vault}:{}),...(source.market?{market:source.market}:{requirements:{name:['NVIDIA GeForce RTX 4090','NVIDIA GeForce RTX 3090']}}),job_definition:definition});
  },
  async start(id){return transport('POST','/deployments/'+id+'/start');},
  async stop(id){const d=await transport('GET','/deployments/'+id);if(!['STOPPED','STOPPING','DRAFT','ARCHIVED'].includes(d.status))await transport('POST','/deployments/'+id+'/stop');return d;}
 };
}
