import {writeFileSync} from 'node:fs';
import {buildJobDefinition,createNosanaClient,SOURCE_DEPLOYMENT} from '../nosana.js';
const id=process.env.NOSANA_DEPLOYMENT_ID||SOURCE_DEPLOYMENT;
// This revision is intentionally inert. Each authenticated app request creates a fresh
// one-image SIMPLE deployment with a real, scoped callback token.
const definition=buildJobDefinition({callbackUrl:process.env.LL_PUBLIC_URL||'https://example.invalid',jobId:'configuration-check',token:'setup-only-no-access',setupOnly:true});
if(process.argv.includes('--write')){
 writeFileSync(new URL('../nosana/job-definition.json',import.meta.url),JSON.stringify({...definition,deployment_id:id},null,2)+'\n');
 console.log('Wrote nosana/job-definition.json (inert template, not applied).');
}else{
 if(!process.env.NOSANA_API_KEY)throw new Error('NOSANA_API_KEY is missing from secure environment settings. No remote settings were changed.');
 const client=createNosanaClient();
 try{
  const before=await client.inspect(id);
  if(['STARTING','RUNNING'].includes(before.status)){
   await client.stop(id);
   let stopped=false;
   for(let i=0;i<20;i++){const state=await client.inspect(id);if(['DRAFT','STOPPED'].includes(state.status)){stopped=true;break;}await new Promise(r=>setTimeout(r,2000));}
   if(!stopped)throw new Error('Deployment is still stopping; revision was not changed.');
  }
  const result=await client.revise(id,{...definition,deployment_id:id});
  console.log(JSON.stringify({status:'configured',deploymentId:id,activeRevision:result.active_revision,sourceAutostart:false,mode:'one-SIMPLE-deployment-per-image'},null,2));
 }catch(e){console.error(e.code||e.message);process.exitCode=1;}
}
