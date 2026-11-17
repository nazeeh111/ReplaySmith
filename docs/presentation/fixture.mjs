import {createServer} from 'node:http';
export async function fixture(port=0){
 const effects={changed:{first:0,later:0},matched:{first:0,later:0}};
 const server=createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');const kind=u.searchParams.get('kind');
  if(u.pathname==='/effect'&&effects[kind]){effects[kind][u.searchParams.get('which')]++;res.end('ok');return;}
  if(u.pathname==='/counts'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(effects));return;}
  if(!effects[kind]){res.writeHead(404);res.end('Use ?kind=changed or ?kind=matched');return;}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Owned continuation fixture</title><button id="first" onclick="${kind==='changed'?"this.textContent='Paused';":''}fetch('/effect?kind=${kind}&which=first').then(()=>document.querySelector('output').textContent='Done')">Pause</button><button id="later" onclick="fetch('/effect?kind=${kind}&which=later').then(()=>document.querySelector('#final').textContent='Next completed')">Next</button><output>Waiting</output><p id="final">Waiting</p></html>`);
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return {origin:`http://127.0.0.1:${server.address().port}`,effects,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})};
}
