import type { Workflow } from './types.js';

const actions = new Set(['navigate', 'click', 'fill', 'select', 'press', 'assert']);
const evidenceFields = new Set(['tag', 'role', 'name', 'text', 'label', 'placeholder', 'testId', 'type', 'href', 'context']);
const inputName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function fail(message: string): never { throw new Error(`Invalid workflow: ${message}`); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, label: string, max = 16384): asserts value is string {
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be a string up to ${max} characters`);
}
function target(value: unknown, label: string): void {
  if (!object(value) || !Array.isArray(value.selectors) || value.selectors.length > 20 || !object(value.evidence)) fail(`${label} needs selectors and evidence`);
  for (const selector of value.selectors) { text(selector, `${label} selector`, 2048); if (!selector) fail('empty selector'); }
  for (const [key, item] of Object.entries(value.evidence)) {
    if (!evidenceFields.has(key)) fail(`unknown evidence field ${key}`);
    text(item, `${label}.${key}`, 2048);
  }
  if (value.selectors.length === 0 && !Object.values(value.evidence).some(v => typeof v === 'string' && v.trim())) fail(`${label} has no identifying evidence`);
}
function httpUrl(value: unknown, label: string): URL {
  text(value, label, 4096);
  // Parameterized paths/query strings are resolved at run time; origins stay literal.
  let url: URL;
  try { url = new URL(value); } catch { return fail(`${label} must be an absolute HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[{}]/.test(url.origin)) fail(`${label} must use an explicit HTTP(S) origin without credentials`);
  return url;
}
/** Validate untrusted JSON. Returns a detached plain copy; never executes source code. */
export function validateWorkflow(value: unknown): Workflow {
  if (!object(value) || value.version !== 1) fail('version must be 1');
  text(value.name, 'name', 120);
  if (!value.name.trim()) fail('name is empty');
  if (value.description !== undefined) text(value.description, 'description', 4096);
  if (!object(value.inputs) || Object.keys(value.inputs).length > 100) fail('inputs must be an object with at most 100 entries');
  for (const [name, entry] of Object.entries(value.inputs)) {
    if (!inputName.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) fail(`invalid input name ${name}`);
    if (!object(entry)) fail(`input ${name} must be an object`);
    if (entry.default !== undefined) text(entry.default, `input ${name} default`);
    if (entry.description !== undefined) text(entry.description, `input ${name} description`, 2048);
    if (entry.secret !== undefined && typeof entry.secret !== 'boolean') fail(`input ${name} secret must be boolean`);
    if (entry.secret === true && entry.default !== undefined) fail(`secret input ${name} cannot store a default`);
  }
  if (!Array.isArray(value.allowedOrigins) || value.allowedOrigins.length === 0 || value.allowedOrigins.length > 32) fail('allowedOrigins needs 1–32 explicit HTTP(S) origins');
  for (const origin of value.allowedOrigins) {
    const url = httpUrl(origin, 'allowed origin');
    if (url.origin !== origin) fail('allowedOrigins entries must be origins only, without paths or trailing slashes');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 500) fail('steps needs 1–500 entries');
  const ids = new Set<string>();
  for (const [index, step] of value.steps.entries()) {
    if (!object(step) || typeof step.action !== 'string' || !actions.has(step.action)) fail(`unsupported action at step ${index + 1}`);
    text(step.id, 'step id', 120);
    if (!step.id || ids.has(step.id)) fail('step ids must be nonempty and unique');
    ids.add(step.id);
    if (step.description !== undefined) text(step.description, 'step description', 2048);
    if (step.sensitive !== undefined && typeof step.sensitive !== 'boolean') fail('sensitive must be boolean');
    if (step.action === 'navigate') {
      const url = httpUrl(step.url, 'navigation URL');
      if (!(value.allowedOrigins as string[]).includes(url.origin)) fail(`navigation origin ${url.origin} is not allowed`);
    } else if (step.action === 'assert') {
      if (!object(step.assertion) || !['visible', 'text', 'value', 'url'].includes(step.assertion.kind as string)) fail('assert step needs a supported assertion');
      if (step.assertion.kind !== 'url') target(step.assertion.target, 'assertion target');
      if (step.assertion.kind !== 'visible') {
        text(step.assertion.value, 'assertion value');
        if (!step.assertion.value) fail('assertion value cannot be empty');
      }
      if (step.assertion.kind === 'url') {
        const url = httpUrl(step.assertion.value, 'assertion URL');
        if (!(value.allowedOrigins as string[]).includes(url.origin)) fail('assertion URL origin is not allowed');
      }
    } else {
      target(step.target, 'step target');
      if (['fill', 'select'].includes(step.action)) text(step.value, 'step value');
      if (step.action === 'press') { text(step.key, 'press key', 100); if (!step.key) fail('press key cannot be empty'); }
    }
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 1_000_000) fail('workflow exceeds 1 MB');
  const allReferences = [...serialized.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)].map(m => m[1]);
  for (const reference of allReferences) if (!Object.hasOwn(value.inputs, reference!)) fail(`undeclared input ${reference}`);
  return JSON.parse(serialized) as Workflow;
}
/** Turn one literal fill/select value into a reusable input without mutating the source. */
export function parameterize(workflow: Workflow, stepId: string, name: string): Workflow {
  const next = validateWorkflow(workflow);
  if (!inputName.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) fail('invalid input name');
  if (Object.hasOwn(next.inputs, name)) fail(`input ${name} already exists`);
  const step = next.steps.find(s => s.id === stepId);
  if (!step || !['fill', 'select'].includes(step.action)) fail('parameterization needs a fill or select step');
  if (/\{\{/.test(step.value!)) fail('step is already parameterized');
  const secret = /password|secret|token|api.?key/i.test(`${name} ${step.target?.evidence.type ?? ''} ${step.target?.evidence.name ?? ''}`);
  next.inputs[name] = secret ? { secret: true, description: 'Required at runtime; not stored in the workflow.' } : { default: step.value };
  step.value = `{{${name}}}`;
  return validateWorkflow(next);
}
