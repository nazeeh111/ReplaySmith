import { createServer, type Server, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from './runner.js';
import { importRecording } from './importer.js';
import { validateWorkflow, parameterize } from './workflow.js';
import { exportPlaywright, exportSkill } from './exporter.js';
import { recordWorkflow } from './recorder.js';
import { demoWorkflow, demoHtml } from './demo.js';
import { prepareWorkflow } from './prepare.js';

const MAX_BODY = 2 * 1024 * 1024;
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Use Content-Type: application/json.');
  let length=0;const chunks:Buffer[]=[];
  for await (const chunk of req) {length+=chunk.length;if(length>MAX_BODY)throw new Error('Request is larger than 2 MiB.');chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected a JSON object.');
  return input;
}
export interface StudioServer { server:Server; origin:string; close:()=>Promise<void> }
export async function startStudio(port=3333):Promise<StudioServer> {
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Port must be between 0 and 65535.');
  let origin='';let busy=false;
  const controller=new AbortController();
  const server=createServer(async(req,res)=>{
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      if(req.headers.host!==new URL(origin).host){send(403,{error:'Invalid Host. Open the printed loopback URL.'});return;}
      if(req.headers.origin&&req.headers.origin!==origin){send(403,{error:'Cross-origin requests are not allowed.'});return;}
      if(req.headers['sec-fetch-site']==='cross-site'){send(403,{error:'Cross-site requests are not allowed.'});return;}
      const url=new URL(req.url??'/',origin);
      if(req.method==='GET'&&url.pathname==='/demo') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(demoHtml(url.searchParams.get('variant')??'original'));return;}
      if(req.method==='GET'&&url.pathname==='/api/example'){send(200,demoWorkflow(origin));return;}
      if(req.method==='POST'&&url.pathname.startsWith('/api/')) {
        const body=await readJson(req);
        switch(url.pathname) {
          case '/api/import':send(200,prepareWorkflow(importRecording(body.recording)));return;
          case '/api/validate':send(200,validateWorkflow(body.workflow));return;
          case '/api/parameterize':send(200,parameterize(validateWorkflow(body.workflow),String(body.stepId??''),String(body.name??'')));return;
          case '/api/export': {
            const workflow=validateWorkflow(body.workflow);
            if(body.format==='playwright')send(200,{files:{'workflow.mjs':exportPlaywright(workflow)}});
            else if(body.format==='skill')send(200,{files:exportSkill(workflow)});
            else send(400,{error:'Choose playwright or skill.'});
            return;
          }
          case '/api/run': {
            if(busy){send(409,{error:'A browser task is already running. Finish it before starting another.'});return;}
            const workflow=validateWorkflow(body.workflow);
            const inputs:Record<string,string>={};
            if(body.inputs!==undefined) {
              if(!body.inputs||typeof body.inputs!=='object'||Array.isArray(body.inputs))throw new Error('Inputs must be an object.');
              for(const [key,value] of Object.entries(body.inputs)) {if(typeof value!=='string'||value.length>10000)throw new Error('Input values must be strings shorter than 10,000 characters.');inputs[key]=value;}
            }
            busy=true;try{send(200,await runWorkflow(workflow,{inputs,allowSensitive:body.allowSensitive===true,headless:true,timeoutMs:5000}));}finally{busy=false;}
            return;
          }
          case '/api/record': {
            if(busy){send(409,{error:'A browser task is already running.'});return;}
            busy=true;
            const recording=new AbortController();
            const abort=()=>recording.abort();controller.signal.addEventListener('abort',abort,{once:true});
            const timer=setTimeout(abort,10*60*1000);
            res.on('close',()=>{if(!res.writableEnded)abort();});
            try{send(200,{workflow:prepareWorkflow(await recordWorkflow(String(body.url??''),{signal:recording.signal}))});}
            finally{busy=false;clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
            return;
          }
          default:send(404,{error:'Unknown API endpoint.'});return;
        }
      }
      if(req.method!=='GET'){send(405,{error:'Method not allowed.'});return;}
      const files:Record<string,[string,string]>={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
      const file=files[url.pathname];if(!file){send(404,{error:'Not found.'});return;}
      const bytes=await readFile(fileURLToPath(new URL(`../studio/${file[0]}`,import.meta.url)));
      res.writeHead(200,{'Content-Type':`${file[1]}; charset=utf-8`,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(bytes);
    } catch(error) {if(!res.headersSent)send(422,{error:error instanceof Error?error.message:'The operation failed.'});else res.end();}
  });
  server.requestTimeout=30_000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Could not bind studio.');
  origin=`http://127.0.0.1:${address.port}`;
  return {server,origin,close:async()=>{controller.abort();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}};
}
