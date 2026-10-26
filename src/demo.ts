import type { Workflow } from './types.js';

export function demoWorkflow(origin: string): Workflow {
  return {
    version: 1, name: 'Save a dispatch note',
    description: 'A local demonstration: change the note, save a draft, and verify its contents.',
    inputs: { note: { default: 'Send the field kit to Avery.', description: 'The note to save' } },
    allowedOrigins: [origin],
    steps: [
      {id:'open',action:'navigate',description:'Open the dispatch desk',url:`${origin}/demo`},
      {id:'note',action:'fill',description:'Write the dispatch note',target:{selectors:['#note'],evidence:{tag:'textarea',role:'textbox',label:'Dispatch note',name:'Dispatch note',context:'Dispatch desk'}},value:'{{note}}'},
      {id:'save',action:'click',description:'Save the draft',target:{selectors:['#save'],evidence:{tag:'button',role:'button',name:'Save draft',text:'Save draft',type:'button',context:'Dispatch desk'}}},
      {id:'verify',action:'assert',description:'Verify the saved note',assertion:{kind:'text',target:{selectors:['#receipt'],evidence:{tag:'output',testId:'receipt'}},value:'Draft saved: {{note}}'}}
    ]
  };
}

/** A real form with independently observable side effects, used by demo and benchmarks. */
export function demoHtml(variant = 'original'): string {
  const drift = variant !== 'original';
  const buttonName = variant === 'renamed' ? 'Store draft' : 'Save draft';
  const missing = variant === 'missing';
  const ambiguous = variant === 'ambiguous';
  const reused = variant === 'reused-id';
  const disabled = variant === 'disabled';
  const wrong = variant === 'wrong-outcome';
  const delayed = variant === 'delayed';
  const button = `<button id="${drift?'save-v2':'save'}" type="button" ${disabled?'disabled':''} data-operation="save">${buttonName}</button>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dispatch desk · ReplaySmith demo</title><style>
  *{box-sizing:border-box}body{margin:0;background:#eeece6;color:#242721;font:16px system-ui}main{max-width:800px;margin:9vh auto;padding:40px;background:#fffef9;border:1px solid #d5d6cc;border-radius:12px}.eyebrow{letter-spacing:.15em;text-transform:uppercase;font-size:12px;color:#717768}h1{font-size:36px;letter-spacing:-.04em;margin:12px 0}p{color:#62685a;line-height:1.6}label{display:block;font-weight:600;margin-top:32px}textarea{width:100%;min-height:110px;font:inherit;margin:12px 0;padding:16px;border:1px solid #b4baa8;border-radius:6px}button{font:600 15px system-ui;padding:13px 22px;background:#d9fa77;color:#253317;border:1px solid #adc35e;border-radius:6px;cursor:pointer}button:disabled{opacity:.4}output{display:block;margin-top:24px;padding:20px;background:#f0f4e7;min-height:62px}.note{font-size:12px;color:#818575;margin-top:32px}.trap{background:#fff2eb;border-color:#d4ab90;margin-left:8px}</style>
  <main><div class="eyebrow">ReplaySmith / local test site</div><section aria-label="Dispatch desk"><h1>Dispatch desk</h1><p>A small task with a clear outcome. Write a note and save it as a draft.</p><label for="${drift?'message-v2':'note'}">Dispatch note</label><textarea id="${drift?'message-v2':'note'}"></textarea><div id="actions">${missing||delayed?'':button}${ambiguous?button.replace('save-v2','another-save'):''}${reused?'<button class="trap" id="save" type="button" data-operation="delete">Delete all drafts</button>':''}</div></section><output id="receipt" data-testid="receipt" aria-live="polite">No draft saved yet.</output><p class="note">Fixture: ${variant.replace(/[^a-z-]/g,'')} · No external data or services.</p></main>
  <script>window.fixtureState={saved:null,wrongActions:0,saveCount:0};document.addEventListener('click',event=>{const op=event.target.dataset.operation;if(op==='delete'){window.fixtureState.wrongActions++;document.querySelector('output').textContent='Drafts deleted';}if(op==='save'){window.fixtureState.saveCount++;const value=document.querySelector('textarea').value;window.fixtureState.saved=${wrong?'"corrupted"':'value'};document.querySelector('output').textContent='Draft saved: '+window.fixtureState.saved;}});${delayed?`setTimeout(()=>document.getElementById('actions').innerHTML=${JSON.stringify(button)},450);`:''}</script></html>`;
}
