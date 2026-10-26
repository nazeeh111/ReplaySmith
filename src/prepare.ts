import type { Workflow } from './types.js';
import { parameterize, validateWorkflow } from './workflow.js';

/** Turn captured literal form values into named defaults. Never changes actions or invents outcomes. */
export function prepareWorkflow(input:Workflow):Workflow {
  let workflow=validateWorkflow(input);
  const literalCounts=new Map<string,number>();
  for(const step of workflow.steps)if(['fill','select'].includes(step.action)&&step.value!==undefined&&!step.value.includes('{{'))literalCounts.set(step.value,(literalCounts.get(step.value)??0)+1);
  const substitute=(content:string,literal:string,name:string)=>{
    const parts=content.split(/(\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\})/g);
    const count=parts.reduce((sum,part,index)=>sum+(index%2===0?part.split(literal).length-1:0),0);
    if(count!==1||(literal.length<3&&content!==literal))return content;
    return parts.map((part,index)=>index%2===0?part.replace(literal,`{{${name}}}`):part).join('');
  };
  for(const original of workflow.steps) {
    if(!['fill','select'].includes(original.action)||original.value===undefined||original.value.includes('{{'))continue;
    const literal=original.value;
    const evidence=original.target?.evidence;
    const proposed=(evidence?.label||evidence?.name||evidence?.placeholder||`input_${original.id}`).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,55);
    const base=/^[a-z]/.test(proposed)?proposed:`input_${proposed||'value'}`;
    let name=base;let suffix=2;
    while(Object.hasOwn(workflow.inputs,name)||['constructor','prototype','__proto__'].includes(name)){name=`${base}_${suffix++}`;}
    workflow=parameterize(workflow,original.id,name);
    // Preserve explicitly recorded checks of the same literal; do not guess derived values.
    if(literal.length>0&&literalCounts.get(literal)===1&&!workflow.inputs[name].secret)for(const step of workflow.steps){
      const check=step.assertion;
      if(!check||!['text','value'].includes(check.kind)||typeof check.value!=='string')continue;
      const previous=check.value;
      check.value=substitute(check.value,literal,name);
      if(check.value!==previous&&check.target)for(const key of ['name','text'] as const)if(check.target.evidence[key]===previous)check.target.evidence[key]=check.value;
    }
  }
  return validateWorkflow(workflow);
}
