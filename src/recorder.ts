import { chromium, type BrowserContext } from 'playwright';
import type { ElementEvidence, Step, Workflow } from './types.js';

export interface RecorderOptions { headless?: boolean; onReady?: (context:BrowserContext)=>Promise<void>; signal?: AbortSignal; }

/** Fresh ephemeral profile. No access to the user's regular browser or password store. */
export async function recordWorkflow(url: string, options: RecorderOptions = {}): Promise<Workflow> {
  const initial = new URL(url);
  if (!['http:', 'https:'].includes(initial.protocol) || initial.username || initial.password) throw new Error('Recording requires an HTTP(S) URL without embedded credentials.');
  const browser = await chromium.launch({headless:options.headless ?? false});
  const context = await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
  const workflow:Workflow = {version:1,name:'Recorded browser task',description:'Review the steps, allowed origins and outcome checks before replay.',inputs:{},allowedOrigins:[initial.origin],steps:[{id:'step-1',action:'navigate',url:initial.href}]};
  let done!: ()=>void;
  const stopped = new Promise<void>(resolve=>{done=resolve;});
  let secretIndex = 0;
  const secretKeys=new Map<string,string>();
  let assertionMode = false;
  const stop=()=>done();
  options.signal?.addEventListener('abort',stop,{once:true});
  try {
    const page = await context.newPage();
    await context.route('**/*',async route=>{
      if(route.request().isNavigationRequest()) {
        const destination=new URL(route.request().url());
        if(destination.origin!==initial.origin) { await route.abort('blockedbyclient'); return; }
      }
      if(route.request().isNavigationRequest()){
        const response=await route.fetch({maxRedirects:0,timeout:30000});
        if(response.status()>=300&&response.status()<400&&response.headers()['location']){await route.abort('blockedbyclient');return;}
        await route.fulfill({response});return;
      }
      await route.continue();
    });
    await context.exposeBinding('__replaysmithCapture', ({frame}, payload:unknown)=> {
      if(frame!==page.mainFrame() || !payload || typeof payload!=='object') return;
      const data=payload as Record<string,unknown>;
      if(data.command==='stop'){done();return;}
      if(data.command==='assert'){assertionMode=true;return;}
      if(workflow.steps.length>=500){done();return;}
      if(!['click','fill','select','press','assert'].includes(String(data.action)))return;
      const evidence=data.evidence as ElementEvidence;
      if(!evidence || typeof evidence!=='object' || typeof data.selector!=='string') return;
      const target={selectors:[data.selector.slice(0,2000)],evidence};
      let value=String(data.value??'').slice(0,10000);
      if(data.secret===true) {
        let key=secretKeys.get(data.selector);
        if(!key){key=`secret_${++secretIndex}`;secretKeys.set(data.selector,key);}
        workflow.inputs[key]={secret:true,description:'Enter the private value when running; the recorder never captured it.'};
        value=`{{${key}}}`;
      }
      const action=String(data.action) as Step['action'];
      const step:Step={id:`step-${workflow.steps.length+1}`,action,target};
      if(action==='fill'||action==='select')step.value=value;
      if(action==='press')step.key=String(data.key??'Enter');
      if(action==='assert'||assertionMode){step.action='assert';const stableEvidence={...evidence};delete stableEvidence.name;delete stableEvidence.text;step.assertion={kind:'text',target:{...target,evidence:stableEvidence},value:String(evidence.text||evidence.name||'')};delete step.target;assertionMode=false;}
      if(action==='click'&&/\b(delete|remove|purchase|pay|send|publish|transfer|checkout|confirm order)\b/i.test(`${evidence.name} ${evidence.text}`))step.sensitive=true;
      const previous=workflow.steps.at(-1);
      if(['fill','select'].includes(step.action)&&previous?.action===step.action&&JSON.stringify(previous.target)===JSON.stringify(step.target)){step.id=previous.id;workflow.steps[workflow.steps.length-1]=step;}
      else workflow.steps.push(step);
    });
    const installRecorder = () => {
      if(window.top!==window)return;
      const send=(payload:unknown)=>{void (window as unknown as {__replaysmithCapture:(p:unknown)=>Promise<void>}).__replaysmithCapture(payload);};
      let asserting=false;
      const lastValues=new WeakMap<Element,string>();
      const describe=(element:Element)=>{
        const el=element as HTMLElement;
        const formEl=el as HTMLInputElement;
        const label='labels' in formEl?Array.from(formEl.labels??[]).map(x=>x.textContent?.trim()??'').join(' '):'';
        const tag=el.tagName.toLowerCase();
        const text=(el.textContent??'').replace(/\s+/g,' ').trim().slice(0,240);
        const name=el.getAttribute('aria-label')||label||el.getAttribute('alt')||text;
        const type=tag==='input'||tag==='button'?formEl.type:'';
        const inputRole=type==='checkbox'?'checkbox':type==='radio'?'radio':['button','submit','reset'].includes(type)?'button':type==='number'?'spinbutton':type==='range'?'slider':['password','hidden'].includes(type)?undefined:'textbox';
        const role=el.getAttribute('role')||({button:'button',a:el.hasAttribute('href')?'link':undefined,textarea:'textbox',select:(el as HTMLSelectElement).multiple?'listbox':'combobox',input:inputRole} as Record<string,string|undefined>)[tag];
        const section=el.closest('section,form,article');
        const context=section?.getAttribute('aria-label')||section?.querySelector('h1,h2,h3,legend')?.textContent?.trim();
        const evidence:Record<string,string|undefined>={tag,name,text,label,role,context,type:el.getAttribute('type')??undefined,testId:el.getAttribute('data-testid')??undefined,placeholder:el.getAttribute('placeholder')??undefined};
        let selector=el.id?`#${CSS.escape(el.id)}`:evidence.testId?`[data-testid=${JSON.stringify(evidence.testId)}]`:'';
        if(!selector){const parts:string[]=[];let node:Element|null=el;while(node&&node!==document.documentElement){const parentEl:Element|null=node.parentElement;const siblings:Element[]=parentEl?Array.from(parentEl.children).filter(x=>x.tagName===node!.tagName):[];parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node)+1})`);node=parentEl;}selector=parts.join(' > ');}
        return{selector,evidence:Object.fromEntries(Object.entries(evidence).filter(([,value])=>typeof value==='string'&&value.length>0))};
      };
      const eligible=(target:EventTarget|null)=>target instanceof Element && !target.closest('#replaysmith-recorder');
      document.addEventListener('click',event=>{
        if(!eligible(event.target))return;
        const raw=event.target as Element;
        if(asserting){event.preventDefault();event.stopImmediatePropagation();asserting=false;send({action:'assert',...describe(raw)});return;}
        const el=raw.closest('button,a,input[type=checkbox],input[type=radio],input[type=submit],input[type=button],input[type=reset],[role=button],[role=link]');
        if(el)send({action:'click',...describe(el)});
      },true);
      const captureValue=(event:Event)=>{
        if(!eligible(event.target))return;
        const el=event.target as HTMLInputElement;
        if(event.type==='input'&&el.tagName==='SELECT')return;
        if(lastValues.get(el)===el.value)return;
        lastValues.set(el,el.value);
        if(!el.matches('input,textarea,select')||el.matches('[type=checkbox],[type=radio],[type=file],[type=hidden]'))return;
        const secret=el.type==='password'||/^(cc-|one-time-code)/.test(el.autocomplete)||/password|token|secret|api.?key|card.?number/i.test(`${el.name} ${el.id}`);
        send({action:el.tagName==='SELECT'?'select':'fill',...describe(el),value:secret?'':el.value,secret});
      };
      document.addEventListener('input',captureValue,true);
      document.addEventListener('change',captureValue,true);
      document.addEventListener('keydown',event=>{if(event.key==='Enter'&&eligible(event.target)&&(event.target as Element).matches('input'))send({action:'press',key:'Enter',...describe(event.target as Element)});},true);
      const mount=()=>{
        if(document.getElementById('replaysmith-recorder'))return;
        const host=document.createElement('div');host.id='replaysmith-recorder';
        host.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483647';
        const root=host.attachShadow({mode:'open'});
        const style=document.createElement('style');style.textContent='div{display:flex;gap:12px;align-items:center;background:#202820;color:#fafcf4;padding:12px 18px;border:1px solid #647158;border-radius:8px;font:13px system-ui;box-shadow:0 6px 30px #0003}button{font:600 12px system-ui;background:#d9fa77;color:#1c2810;border:0;border-radius:4px;padding:9px 12px;cursor:pointer}';root.append(style);
        const bar=document.createElement('div');const label=document.createElement('span');label.textContent='● ReplaySmith recording';
        const assertBtn=document.createElement('button');assertBtn.textContent='Assert text';assertBtn.id='assert';assertBtn.onclick=()=>{asserting=true;label.textContent='Click the outcome text to verify';};
        const stopBtn=document.createElement('button');stopBtn.textContent='Stop & review';stopBtn.id='stop';stopBtn.onclick=()=>send({command:'stop'});
        bar.append(label,assertBtn,stopBtn);root.append(bar);document.documentElement.append(host);
      };
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
    };
    await context.addInitScript(`(() => { const __name = (fn) => fn; (${installRecorder.toString()})(); })()`);
    page.on('framenavigated',frame=>{
      if(frame!==page.mainFrame()||frame.url()==='about:blank'||frame.url()===initial.href)return;
      if(new URL(frame.url()).origin!==initial.origin)return;
      // Clicks and Enter already drive navigation. Add explicit navigation only for address-bar moves.
      if(!['click','press'].includes(workflow.steps.at(-1)?.action??''))workflow.steps.push({id:`step-${workflow.steps.length+1}`,action:'navigate',url:frame.url()});
    });
    browser.on('disconnected',done);
    page.on('close',done);
    await page.goto(initial.href,{waitUntil:'domcontentloaded',timeout:30000});
    if(options.onReady)await options.onReady(context);
    if(options.signal?.aborted)done();
    await stopped;
    return workflow;
  } finally {
    options.signal?.removeEventListener('abort',stop);
    await browser.close();
  }
}
