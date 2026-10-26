import type { Assertion, ElementEvidence, Step, Target, Workflow } from './types.js';
import { validateWorkflow } from './workflow.js';

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function inferEvidence(selectors: string[]): ElementEvidence {
  const evidence: ElementEvidence = {};
  for (const selector of selectors) {
    const aria = selector.match(/^aria\/(.*?)(?:\[role=["']?([^\]"']+)["']?\])?$/);
    if (aria) { evidence.name = aria[1]; if (aria[2]) evidence.role = aria[2]; }
    if (selector.startsWith('text/')) evidence.text = selector.slice(5);
    const testId = selector.match(/\[data-testid=["']([^"']+)["']\]/);
    if (testId) evidence.testId = testId[1];
    const type = selector.match(/\[type=["']?(password|text|email|search|number|tel|url|checkbox|radio)["']?\]/);
    if (type) evidence.type = type[1];
    const placeholder = selector.match(/\[placeholder=["']([^"']+)["']\]/);
    if (placeholder) evidence.placeholder = placeholder[1];
    const tag = selector.match(/^(button|input|select|textarea|a)(?:[.#[:]|$)/);
    if (tag) evidence.tag = tag[1];
  }
  return evidence;
}
function target(step: Record<string, unknown>, index: number): Target {
  if (!Array.isArray(step.selectors)) throw new Error(`Recording step ${index + 1}: selectors are required`);
  const selectors: string[] = [];
  for (const alternatives of step.selectors) {
    const path = typeof alternatives === 'string' ? [alternatives] : alternatives;
    if (!Array.isArray(path) || path.length !== 1 || typeof path[0] !== 'string') throw new Error(`Recording step ${index + 1}: multi-part/shadow selector paths are not supported; simplify the recording`);
    if (path[0].startsWith('pierce/')) { selectors.push(path[0].slice(7)); continue; }
    if (path[0].startsWith('xpath/')) { selectors.push(`xpath=${path[0].slice(6)}`); continue; }
    selectors.push(path[0]);
  }
  return { selectors: [...new Set(selectors)], evidence: inferEvidence(selectors) };
}
function navigationAssertion(url: string): Assertion { return { kind: 'url', value: url }; }
/** Import the supported Chrome DevTools Recorder subset. Unsupported behavior fails visibly. */
export function importRecording(value: unknown): Workflow {
  if (record(value) && value.version === 1) return validateWorkflow(value);
  if (!record(value) || !Array.isArray(value.steps)) throw new Error('Expected a Chrome DevTools Recorder JSON object with a steps array');
  if (value.steps.length > 500) throw new Error('Recording exceeds 500 steps');
  const steps: Step[] = [];
  const origins = new Set<string>();
  const inputs: Workflow['inputs'] = {};
  let secretCount = 0;
  let focusedTarget: Target | undefined;
  let pressedKey: string | undefined;
  for (const [index, raw] of value.steps.entries()) {
    if (!record(raw) || typeof raw.type !== 'string') throw new Error(`Recording step ${index + 1}: missing type`);
    if (raw.frame !== undefined && (!Array.isArray(raw.frame) || raw.frame.length > 0)) throw new Error(`Recording step ${index + 1}: frames are not supported`);
    if (raw.target !== undefined && raw.target !== 'main') throw new Error(`Recording step ${index + 1}: popup/secondary targets are not supported`);
    if (raw.assertedEvents !== undefined && !Array.isArray(raw.assertedEvents)) throw new Error(`Recording step ${index + 1}: assertedEvents must be an array`);
    const id = `step-${steps.length + 1}`;
    switch (raw.type) {
      case 'setViewport': break; // Viewport is presentation state, not a browser action.
      case 'navigate': {
        if (typeof raw.url !== 'string') throw new Error('Navigation needs a URL');
        origins.add(new URL(raw.url).origin);
        focusedTarget = undefined;
        steps.push({ id, action: 'navigate', url: raw.url });
        break;
      }
      case 'click': {
        if ((raw.button !== undefined && raw.button !== 'primary') || (raw.clickCount !== undefined && raw.clickCount !== 1)) throw new Error(`Recording step ${index + 1}: only a single primary click is supported`);
        const aim = target(raw, index);
        focusedTarget = aim;
        const sensitive = /\b(pay|purchase|buy|delete|remove|send|publish|transfer|confirm order|place order|submit)\b/i.test(`${aim.evidence.name ?? ''} ${aim.evidence.text ?? ''}`);
        steps.push({ id, action: 'click', target: aim, ...(sensitive ? { sensitive: true } : {}) });
        break;
      }
      case 'change': {
        if (typeof raw.value !== 'string') throw new Error('Change step needs a string value');
        const aim = target(raw, index);
        focusedTarget = aim;
        const secret = aim.evidence.type === 'password' || /password|secret|token|api.?key|card.?number/i.test(`${aim.evidence.name ?? ''} ${aim.evidence.label ?? ''} ${aim.selectors.join(' ')}`);
        let value = raw.value;
        if (secret) { const name = `secret_${++secretCount}`; inputs[name] = {secret: true, description: 'Required at runtime; imported private literal was discarded.'}; value = `{{${name}}}`; }
        steps.push({ id, action: 'fill', target: aim, value });
        break;
      }
      case 'keyDown': {
        if (typeof raw.key !== 'string' || ['Shift', 'Control', 'Alt', 'Meta'].includes(raw.key)) throw new Error(`Recording step ${index + 1}: modifier-key sequences are unsupported`);
        const aim = raw.selectors !== undefined ? target(raw, index) : focusedTarget;
        if (!aim) throw new Error(`Recording step ${index + 1}: a key press needs a preceding focused target`);
        pressedKey = raw.key;
        steps.push({ id, action: 'press', target: aim, key: raw.key });
        break;
      }
      case 'keyUp': {
        if (raw.key !== pressedKey || !pressedKey) throw new Error(`Recording step ${index + 1}: unmatched keyUp is unsupported`);
        pressedKey = undefined;
        break; // A press already releases its key.
      }
      default: throw new Error(`Recording step ${index + 1}: unsupported action "${raw.type}"; no steps were silently dropped`);
    }
    if (Array.isArray(raw.assertedEvents)) for (const event of raw.assertedEvents) {
      if (!record(event) || event.type !== 'navigation' || typeof event.url !== 'string') throw new Error(`Recording step ${index + 1}: unsupported asserted event`);
      origins.add(new URL(event.url).origin);
      steps.push({ id: `step-${steps.length + 1}`, action: 'assert', assertion: navigationAssertion(event.url) });
    }
  }
  return validateWorkflow({ version: 1, name: typeof value.title === 'string' ? value.title : 'Imported recording', inputs, allowedOrigins: [...origins], steps });
}
