const $ = (id) => document.getElementById(id);
const state = { workflow: null, selected: 0, inputs: {}, report: null, busy: false, view: 'workflow', file: '', revision: 0, dirty: false, sourceDirty: false };
const actionNames = { navigate: 'Open page', click: 'Click element', fill: 'Fill field', select: 'Select option', press: 'Press key', assert: 'Check outcome' };
const actionIcons = { navigate: '↗', click: '↖', fill: 'Aa', select: '⌄', press: '⌨', assert: '✓' };
const statusNames = { passed: 'Passed', recovered: 'Recovered', abstained: 'Abstained', failed: 'Failed' };

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'on') for (const [event, handler] of Object.entries(value)) element.addEventListener(event, handler);
    else if (key === 'value') element.value = value;
    else if (key === 'checked') element.checked = Boolean(value);
    else if (key === 'disabled') element.disabled = Boolean(value);
    else if (value !== null && value !== undefined && value !== false) element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
function showNotice(message, kind = 'info') {
  const notice = $('notice');
  notice.className = `notice ${kind}`;
  notice.replaceChildren(node('button', { type: 'button', text: 'Dismiss', on: { click: () => { notice.hidden = true; } } }), node('span', { text: message }));
  notice.hidden = false;
}
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`The local server returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Request failed (${response.status}).`);
  return data;
}
function unwrapWorkflow(data) { return data.workflow || data; }
function markUnrun() {
  state.report = null;
  $('report-indicator').hidden = true;
  $('workflow-status').className = 'status-badge';
  $('workflow-status').textContent = 'Not run';
  $('footer-state').textContent = state.workflow ? 'Ready for a verified run' : 'Ready to build';
}
function setBusy(busy, message) {
  state.busy = busy;
  for (const id of ['example-button', 'empty-example-button', 'record-button', 'import-button', 'run-button', 'export-button', 'add-assertion-button', 'apply-source-button', 'download-json-button', 'save-origins-button']) {
    const control = $(id);
    if (control) control.disabled = busy || (!state.workflow && ['run-button', 'export-button', 'add-assertion-button', 'apply-source-button', 'download-json-button', 'save-origins-button'].includes(id));
  }
  $('workflow-name').disabled = busy || !state.workflow;
  $('allow-sensitive').disabled = busy;
  $('source-editor').disabled = busy || !state.workflow;
  $('origins-editor').disabled = busy || !state.workflow;
  $('run-button').replaceChildren(node('span', { 'aria-hidden': 'true', text: busy ? '◌' : '▶', class: busy ? 'running-pulse' : '' }), busy ? 'Working…' : 'Run workflow');
  if (message) $('footer-state').textContent = message;
  $('step-editor').classList.toggle('pending', busy);
  $('input-fields').classList.toggle('pending', busy);
}
function stepTitle(step) {
  if (step.description) return step.description;
  if (step.action === 'navigate') { try { return `Open ${new URL(step.url).hostname}`; } catch { return 'Open page'; } }
  if (step.action === 'assert') return `Check ${step.assertion?.kind || 'outcome'}`;
  const evidence = step.target?.evidence;
  return [actionNames[step.action]?.split(' ')[0] || step.action, evidence?.name || evidence?.label || evidence?.text || evidence?.placeholder || 'element'].join(' ');
}
function renderSteps() {
  const workflow = state.workflow;
  $('step-list').replaceChildren();
  $('empty-steps').hidden = Boolean(workflow?.steps.length);
  $('step-count').textContent = workflow ? String(workflow.steps.length) : '0';
  const checks = workflow?.steps.filter((step) => step.action === 'assert').length || 0;
  $('assertion-count').textContent = `${checks} ${checks === 1 ? 'check' : 'checks'}`;
  workflow?.steps.forEach((step, index) => {
    const result = state.report?.steps.find((item) => item.id === step.id);
    const button = node('button', { type: 'button', class: `step-row${index === state.selected ? ' selected' : ''}`, 'aria-current': index === state.selected ? 'step' : undefined, 'aria-label': `Step ${index + 1}: ${stepTitle(step)}`, on: { click: async () => { if (state.busy) return; if (state.dirty && !await saveStep()) return; state.selected = index; renderSteps(); renderEditor(); } } },
      node('span', { class: 'step-number', text: String(index + 1).padStart(2, '0') }),
      node('span', { class: 'step-row-text' }, node('span', { class: 'step-label', text: stepTitle(step) }), node('span', { class: 'step-kind', text: step.action === 'assert' ? 'Outcome check' : `${step.action}${step.sensitive ? ' · sensitive' : ''}` })),
      result ? node('span', { class: `step-status ${result.status}`, text: result.status === 'passed' || result.status === 'recovered' ? '✓' : '!', 'aria-label': statusNames[result.status] }) : null);
    $('step-list').append(node('li', {}, button));
  });
}
function field(label, id, value, { type = 'text', mono = false, placeholder = '', hint, rows } = {}) {
  const input = node(rows ? 'textarea' : 'input', { id, name: id, class: `text-field${mono ? ' mono' : ''}`, value: value || '', type: rows ? undefined : type, rows, placeholder, spellcheck: mono ? 'false' : undefined });
  return node('div', {}, node('label', { class: 'field-label', for: id, text: label }), input, hint ? node('p', { class: 'field-hint', text: hint }) : null);
}
function renderEditor() {
  const workflow = state.workflow;
  const step = workflow?.steps[state.selected];
  const editor = $('step-editor');
  if (!step) {
    editor.replaceChildren(node('div', { class: 'editor-empty' }, node('span', { class: 'empty-symbol', 'aria-hidden': 'true', text: '↳' }), node('h2', { text: workflow ? 'Add an outcome check.' : 'A reliable workflow starts here.' }), node('p', { text: workflow ? 'Define what success looks like before running your workflow.' : 'Import a Chrome DevTools Recorder file, record a task, or explore the working example.' }), node('button', { class: 'button button-orange', text: workflow ? 'Add outcome check' : 'Explore the example →', on: { click: () => workflow ? $('assertion-dialog').showModal() : loadExample() } })));
    return;
  }
  const form = node('form', { id: 'step-form', on: { submit: saveStep, input: () => { state.dirty = true; const save = form.querySelector('.save-step'); if (save) { save.textContent = 'Apply changes •'; save.classList.add('has-changes'); } } } });
  const heading = node('div', { class: 'editor-heading' }, node('div', {}, node('p', { class: 'eyebrow', text: `STEP ${String(state.selected + 1).padStart(2, '0')} / ${String(workflow.steps.length).padStart(2, '0')}` }), node('h2', { text: actionNames[step.action] || step.action })), node('span', { class: 'step-action-icon', 'aria-hidden': 'true', text: actionIcons[step.action] || '↳' }));
  const actionCard = node('section', { class: 'editor-card', 'aria-label': 'Step action' }, node('div', { class: 'editor-card-heading' }, node('h3', { text: 'Action' }), node('span', { class: 'micro-badge', text: step.action })), field('Description', 'step-description', step.description, { placeholder: stepTitle(step) }));
  if (step.action === 'navigate') actionCard.append(field('Destination URL', 'step-url', step.url, { mono: true, placeholder: 'https://example.com' }));
  if (['fill', 'select'].includes(step.action)) {
    const valueField = field('Value', 'step-value', step.value, { mono: true, hint: 'Use {{input_name}} to insert a reusable input.' });
    const wrapper = node('div', { class: 'value-row' });
    wrapper.append(valueField.querySelector('input'));
    if (step.action === 'fill' && !/\{\{/.test(step.value || '')) wrapper.append(node('button', { type: 'button', class: 'parameter-button', text: '{ } Make input', on: { click: async () => { if (state.dirty && !await saveStep()) return; $('parameter-name').value = ''; $('parameter-dialog').showModal(); $('parameter-name').focus(); } } }));
    valueField.insertBefore(wrapper, valueField.querySelector('.field-hint'));
    actionCard.append(valueField);
  }
  if (step.action === 'press') actionCard.append(field('Key', 'step-key', step.key, { mono: true, placeholder: 'Enter' }));
  if (step.action === 'assert') {
    const kindSelect = node('select', { id: 'step-assertion-kind', class: 'text-field' }, ...['visible', 'text', 'value', 'url'].map((kind) => node('option', { value: kind, text: { visible: 'Element is visible', text: 'Element text equals', value: 'Field has value', url: 'Page URL' }[kind] })));
    kindSelect.value = step.assertion?.kind || 'visible';
    actionCard.append(node('label', { for: 'step-assertion-kind', class: 'field-label', text: 'Outcome check' }), kindSelect, field('Expected value', 'step-assertion-value', step.assertion?.value, { mono: true, hint: 'Required for text, value, and URL checks. Inputs such as {{query}} are supported.' }));
  }
  if (step.action !== 'assert' && step.action !== 'navigate') actionCard.append(node('label', { class: 'checkbox-label' }, node('input', { type: 'checkbox', id: 'step-sensitive', checked: step.sensitive }), node('span', { text: 'Mark this action as sensitive (no recovery; explicit permission)' })));
  form.append(actionCard);
  const target = step.target || step.assertion?.target;
  if (step.action !== 'navigate') {
    const evidence = target?.evidence || {};
    const evidenceCard = node('section', { class: 'editor-card', 'aria-label': 'Element evidence' }, node('div', { class: 'editor-card-heading' }, node('h3', { text: step.action === 'assert' ? 'Check target' : 'Element evidence' }), node('span', { class: 'micro-badge', text: 'INSPECTABLE' })));
    const evidenceGrid = node('div', { class: 'evidence-grid' });
    for (const key of ['role', 'name', 'tag', 'context']) evidenceGrid.append(node('div', { class: 'evidence-entry' }, node('label', { text: key }), node('span', { class: evidence[key] ? '' : 'empty', text: evidence[key] || 'Not recorded' })));
    evidenceCard.append(evidenceGrid);
    const targetEditor = node('textarea', { id: 'step-target', class: 'evidence-editor', value: JSON.stringify(target || { selectors: [], evidence: {} }, null, 2), rows: 7, spellcheck: 'false', 'aria-label': 'Target selectors and evidence JSON' });
    evidenceCard.append(node('details', { class: 'evidence-details' }, node('summary', { text: `Inspect & edit selectors${target?.selectors?.length ? ` (${target.selectors.length})` : ''} and evidence` }), targetEditor), node('p', { class: 'evidence-help' }, node('span', { 'aria-hidden': 'true', text: '↳' }), 'Evidence helps identify the same element after a page changes. Recovery may abstain when candidates are too close.'));
    form.append(evidenceCard);
  }
  form.append(node('div', { class: 'editor-bottom' }, node('button', { type: 'button', class: 'danger-button', text: 'Remove step', on: { click: removeStep } }), node('button', { type: 'submit', class: 'button button-outline save-step', text: 'Apply step changes' })));
  editor.replaceChildren(heading, form);
  const lastAction = workflow.steps.map((item) => item.action !== 'assert').lastIndexOf(true);
  const hasCheck = workflow.steps.slice(lastAction + 1).some((item) => item.action === 'assert');
  editor.append(node('div', { class: `check-note${hasCheck ? '' : ' unverified'}` }, node('span', { 'aria-hidden': 'true', text: hasCheck ? '✓' : '!' }), node('div', {}, node('strong', { text: hasCheck ? 'This workflow has final outcome checks.' : 'End with a check to verify success.' }), node('br'), hasCheck ? 'A run is verified only when its final checks pass.' : 'Successful clicks alone do not verify the intended result. Add an outcome check after the last action.')));
}
function renderInputs() {
  const workflow = state.workflow;
  const entries = Object.entries(workflow?.inputs || {});
  $('input-count').textContent = String(entries.length);
  $('no-inputs').hidden = Boolean(entries.length);
  $('input-fields').replaceChildren(...entries.map(([name, definition], index) => {
    const id = `run-input-${index}`;
    if (!(name in state.inputs)) state.inputs[name] = definition.default || '';
    return node('div', { class: 'config-input' }, node('label', { for: id }, name, definition.secret ? node('span', { class: 'input-secret', text: 'PRIVATE INPUT' }) : null), node('input', { class: 'text-field', id, type: definition.secret ? 'password' : 'text', value: state.inputs[name], autocomplete: 'off', on: { input: (event) => { state.inputs[name] = event.target.value; if (state.report) { markUnrun(); renderSteps(); renderReport(); } } } }), definition.description ? node('p', { class: 'input-help', text: definition.description }) : null);
  }));
}
function renderOrigins() {
  $('origin-list').replaceChildren(...(state.workflow?.allowedOrigins || []).map((origin) => node('span', { class: 'origin-chip', text: origin })));
  $('origins-editor').value = (state.workflow?.allowedOrigins || []).join('\n');
}
function applyWorkflow(workflow, { keepInputs = false, keepSelection = false } = {}) {
  state.workflow = workflow;
  state.dirty = false;
  state.sourceDirty = false;
  $('apply-source-button').textContent = 'Validate & apply';
  state.revision += 1;
  state.selected = keepSelection ? Math.max(0, Math.min(state.selected, workflow.steps.length - 1)) : 0;
  if (!keepInputs) state.inputs = {};
  markUnrun();
  $('workflow-name').value = workflow.name;
  document.title = `${workflow.name} · ReplaySmith`;
  $('source-editor').value = JSON.stringify(workflow, null, 2);
  renderSteps(); renderEditor(); renderInputs(); renderOrigins(); renderReport();
  setBusy(state.busy);
}
function switchView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.view-tab')) { const active = tab.dataset.view === view; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
  for (const name of ['workflow', 'report', 'source']) $(`view-${name}`).hidden = name !== view;
  if (view === 'source' && state.workflow && !state.sourceDirty) $('source-editor').value = JSON.stringify(state.workflow, null, 2);
}
async function loadExample() {
  if (state.busy) return;
  setBusy(true, 'Loading the example…');
  try { const workflow = unwrapWorkflow(await request('/api/example')); applyWorkflow(workflow); switchView('workflow'); showNotice('Example loaded. Review the steps, change an input, then run it against the local demo site.', 'success'); }
  catch (error) { showNotice(`Could not load the example. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); }
}
async function importFile(file) {
  if (!file || state.busy) return;
  if (file.size > 2 * 1024 * 1024) { showNotice('Choose a recording smaller than 2 MB.', 'error'); return; }
  setBusy(true, 'Reading your recording…');
  try {
    const recording = JSON.parse(await file.text());
    const workflow = unwrapWorkflow(await request('/api/import', { recording }));
    state.file = file.name; applyWorkflow(workflow); switchView('workflow');
    showNotice(`Imported ${file.name}. Review actions and private data, then add an outcome check if needed.`, 'success');
  } catch (error) { showNotice(`Could not import this recording. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); $('file-input').value = ''; }
}
async function saveStep(event) {
  event?.preventDefault(); if (!state.workflow || state.busy) return false;
  const workflow = structuredClone(state.workflow), step = workflow.steps[state.selected];
  try {
    const description = $('step-description').value.trim();
    if (description) step.description = description; else delete step.description;
    if ($('step-url')) step.url = $('step-url').value.trim();
    if ($('step-value')) step.value = $('step-value').value;
    if ($('step-key')) step.key = $('step-key').value;
    if ($('step-sensitive')) step.sensitive = $('step-sensitive').checked;
    if (step.action === 'assert') {
      step.assertion ||= {};
      step.assertion.kind = $('step-assertion-kind').value;
      const value = $('step-assertion-value').value;
      if (step.assertion.kind === 'visible') delete step.assertion.value; else step.assertion.value = value;
      if (step.assertion.kind === 'url') delete step.assertion.target;
      else step.assertion.target = JSON.parse($('step-target').value);
    } else if ($('step-target')) step.target = JSON.parse($('step-target').value);
    setBusy(true, 'Validating your changes…');
    const validated = unwrapWorkflow(await request('/api/validate', { workflow }));
    applyWorkflow(validated, { keepInputs: true, keepSelection: true });
    showNotice('Step changes applied. Run again to verify the updated workflow.', 'success');
    return true;
  } catch (error) { showNotice(`Step changes were not applied. ${errorMessage(error)}`, 'error'); return false; }
  finally { setBusy(false); }
}
async function removeStep() {
  if (!state.workflow || state.busy) return;
  const step = state.workflow.steps[state.selected];
  if (!confirm(`Remove “${stepTitle(step)}” from this workflow?`)) return;
  const workflow = structuredClone(state.workflow); workflow.steps.splice(state.selected, 1);
  setBusy(true, 'Validating workflow…');
  try { applyWorkflow(unwrapWorkflow(await request('/api/validate', { workflow })), { keepInputs: true, keepSelection: true }); showNotice('Step removed. Download your workflow JSON to keep a versioned copy.', 'success'); }
  catch (error) { showNotice(`Could not remove the step. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); }
}
async function parameterize(event) {
  event.preventDefault(); if (!state.workflow || state.busy) return;
  const name = $('parameter-name').value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { showNotice('Use a valid input name, starting with a letter or underscore.', 'error'); return; }
  setBusy(true, 'Creating a reusable input…');
  try { const workflow = unwrapWorkflow(await request('/api/parameterize', { workflow: state.workflow, stepId: state.workflow.steps[state.selected].id, name })); applyWorkflow(workflow, { keepInputs: true, keepSelection: true }); $('parameter-dialog').close(); showNotice(`Input “${name}” is ready in Run configuration.`, 'success'); }
  catch (error) { showNotice(`Could not create the input. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); }
}
function updateAssertionFields() {
  const kind = $('assertion-kind').value;
  $('assertion-selector-field').hidden = kind === 'url';
  $('assertion-selector').required = kind !== 'url';
  $('assertion-value-field').hidden = kind === 'visible';
  $('assertion-value').required = kind !== 'visible';
  $('assertion-value').placeholder = kind === 'url' ? 'https://example.com/success' : 'Saved successfully';
}
async function addAssertion(event) {
  event.preventDefault(); if (!state.workflow || state.busy) return;
  const kind = $('assertion-kind').value, workflow = structuredClone(state.workflow);
  const assertion = { kind };
  if (kind !== 'visible') assertion.value = $('assertion-value').value;
  if (kind !== 'url') assertion.target = { selectors: [$('assertion-selector').value.trim()], evidence: {} };
  let sequence = workflow.steps.length + 1;
  while (workflow.steps.some((step) => step.id === `check-${sequence}`)) sequence += 1;
  const step = { id: `check-${sequence}`, action: 'assert', description: $('assertion-description').value.trim() || 'Verify the intended outcome', assertion };
  workflow.steps.push(step);
  setBusy(true, 'Adding an outcome check…');
  try { const validated = unwrapWorkflow(await request('/api/validate', { workflow })); state.selected = validated.steps.length - 1; applyWorkflow(validated, { keepInputs: true, keepSelection: true }); $('assertion-dialog').close(); $('assertion-form').reset(); updateAssertionFields(); showNotice('Outcome check added. A successful run must pass this check.', 'success'); }
  catch (error) { showNotice(`Could not add the check. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); }
}
async function applySource() {
  if (state.busy) return false;
  let workflow;
  try { workflow = JSON.parse($('source-editor').value); } catch (error) { showNotice(`The source is not valid JSON. ${errorMessage(error)}`, 'error'); return false; }
  setBusy(true, 'Validating source…');
  try { applyWorkflow(unwrapWorkflow(await request('/api/validate', { workflow }))); showNotice('Workflow source validated and applied.', 'success'); return true; }
  catch (error) { showNotice(`Source changes were not applied. ${errorMessage(error)}`, 'error'); return false; }
  finally { setBusy(false); }
}
async function saveOrigins() {
  if (!state.workflow || state.busy) return;
  const origins = [...new Set($('origins-editor').value.split('\n').map((value) => value.trim()).filter(Boolean))];
  if (state.dirty && !await saveStep()) return;
  const workflow = structuredClone(state.workflow);
  workflow.allowedOrigins = origins;
  setBusy(true, 'Validating allowed origins…');
  try { applyWorkflow(unwrapWorkflow(await request('/api/validate', { workflow })), { keepInputs: true, keepSelection: true }); showNotice('Allowed origins updated.', 'success'); }
  catch (error) { showNotice(`Origins were not applied. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); }
}
async function runWorkflow() {
  if (!state.workflow || state.busy) return;
  if (state.dirty && !await saveStep()) return;
  if (state.sourceDirty && !await applySource()) return;
  setBusy(true, 'Executing in a fresh local browser…');
  $('workflow-status').className = 'status-badge running'; $('workflow-status').textContent = 'Running';
  $('notice').hidden = true;
  try {
    const data = await request('/api/run', { workflow: state.workflow, inputs: state.inputs, allowSensitive: $('allow-sensitive').checked });
    state.report = data.result || data;
    $('report-indicator').hidden = false;
    $('workflow-status').className = `status-badge ${state.report.status}`;
    $('workflow-status').textContent = state.report.status === 'passed' && state.report.verified ? 'Verified' : statusNames[state.report.status] || state.report.status;
    $('footer-state').textContent = state.report.verified ? 'Run complete · outcome verified' : `Run complete · ${state.report.status}${state.report.status === 'passed' ? ' · no outcome checks' : ''}`;
    renderSteps(); renderReport(); switchView('report');
  } catch (error) { markUnrun(); showNotice(`The run could not complete. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); }
}
function formatDuration(durationMs) { return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${Math.round(durationMs)}ms`; }
function renderReport() {
  const result = state.report;
  const content = $('report-content');
  if (!result) { content.replaceChildren(node('div', { class: 'panel-empty' }, node('span', { class: 'empty-symbol', 'aria-hidden': 'true', text: '✓' }), node('h2', { text: 'Evidence after execution.' }), node('p', { text: 'Run your workflow to see what passed, what recovered, and where ReplaySmith stopped.' }))); return; }
  const recovered = result.steps.filter((step) => step.status === 'recovered').length;
  const passed = result.steps.filter((step) => ['passed', 'recovered'].includes(step.status)).length;
  const title = result.status === 'passed' ? result.verified ? 'The outcome checks passed.' : 'Steps passed. Outcome unverified.' : result.status === 'abstained' ? 'Stopped before an uncertain action.' : 'A step needs your attention.';
  const explanation = result.status === 'passed' ? result.verified ? 'Every executed step completed and the workflow’s explicit checks succeeded.' : 'Add an outcome check to confirm that these actions achieved the intended result.' : result.status === 'abstained' ? 'Review the evidence below. Refine the target or workflow before running again.' : 'Inspect the first failed step, update the workflow, and run it again.';
  const metrics = node('div', { class: 'report-metrics' }, ...[[`${passed}/${state.workflow.steps.length}`, 'Steps passed'], [String(recovered), 'Recovered'], [formatDuration(result.durationMs), 'Total time']].map(([value, label]) => node('div', { class: 'metric' }, node('strong', { text: value }), node('span', { text: label }))));
  const list = node('ol', { class: 'report-step-list' });
  result.steps.forEach((item, index) => {
    const step = state.workflow.steps.find((entry) => entry.id === item.id);
    const li = node('li', { class: 'report-step' }, node('div', { class: 'report-step-heading' }, node('span', { class: 'report-step-number', text: String(index + 1).padStart(2, '0') }), node('div', { class: 'report-step-text' }, node('strong', { text: step ? stepTitle(step) : item.id }), node('small', { text: `${item.action}${item.strategy ? ` · ${item.strategy}` : ''}` })), node('span', { class: `result-tag ${item.status}`, text: statusNames[item.status] || item.status }), node('span', { class: 'report-step-time', text: formatDuration(item.durationMs) })));
    if (item.message) li.append(node('p', { class: 'report-message', text: item.message }));
    if (item.candidates?.length) {
      const candidates = node('div', { class: 'candidate-list' }, ...item.candidates.map((candidate, candidateIndex) => node('article', { class: 'candidate' }, node('div', { class: 'candidate-head' }, node('strong', { text: candidate.evidence.name || candidate.evidence.text || candidate.evidence.label || `Candidate ${candidateIndex + 1}` }), node('span', { class: 'candidate-score', text: `score ${Number(candidate.score).toFixed(2)}` })), node('p', { class: 'candidate-reasons', text: candidate.reasons.join(' · ') }), node('pre', { class: 'candidate-evidence', text: JSON.stringify(candidate.evidence, null, 2) }))));
      li.append(node('details', { class: 'candidate-details', open: item.status === 'abstained' }, node('summary', { text: `Inspect ${item.candidates.length} ranked ${item.candidates.length === 1 ? 'candidate' : 'candidates'}` }), candidates));
    }
    list.append(li);
  });
  content.replaceChildren(node('div', { class: 'report-summary' }, node('div', { class: 'report-title' }, node('p', { class: 'eyebrow', text: 'EXECUTION REPORT' }), node('h2', { text: title }), node('p', { text: explanation })), metrics), list);
}
async function startRecording(event) {
  event.preventDefault(); if (state.busy) return;
  const url = $('record-url').value.trim();
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an http or https URL.'); } catch (error) { showNotice(`Cannot record this address. ${errorMessage(error)}`, 'error'); return; }
  $('record-dialog').close(); setBusy(true, 'Recording in the browser · finish the task and stop recording there');
  showNotice('A recording browser is opening. Demonstrate the task, then use its stop recording control to return here.');
  try { const workflow = unwrapWorkflow(await request('/api/record', { url })); applyWorkflow(workflow); switchView('workflow'); showNotice('Recording imported. Review every step and private value, then add an outcome check before replaying.', 'success'); }
  catch (error) { showNotice(`Recording did not finish. ${errorMessage(error)}`, 'error'); }
  finally { setBusy(false); }
}
function safeFilename(value) { return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[-.]+/, '').slice(0, 100) || 'workflow'; }
function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const anchor = node('a', { href: url, download: name }); document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadJSON() { if (state.workflow) download(`${safeFilename(state.workflow.name)}.json`, `${JSON.stringify(state.workflow, null, 2)}\n`, 'application/json'); }
// ZIP storage mode keeps skill exports dependency-free. Each entry is UTF-8 and uncompressed.
function zipFiles(files) {
  const encoder = new TextEncoder(), parts = [], directory = [];
  let offset = 0;
  const u16 = (view, position, value) => view.setUint16(position, value, true);
  const u32 = (view, position, value) => view.setUint32(position, value, true);
  const crc32 = (bytes) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
  for (const [rawName, text] of Object.entries(files)) {
    const name = rawName.split(/[\\/]+/).filter((part) => part && part !== '.' && part !== '..').map(safeFilename).join('/');
    if (!name) continue;
    const filename = encoder.encode(name), content = encoder.encode(text), crc = crc32(content);
    const header = new Uint8Array(30 + filename.length), h = new DataView(header.buffer);
    u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x0800); u16(h, 12, 33); u32(h, 14, crc); u32(h, 18, content.length); u32(h, 22, content.length); u16(h, 26, filename.length); header.set(filename, 30);
    const central = new Uint8Array(46 + filename.length), c = new DataView(central.buffer);
    u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20); u16(c, 8, 0x0800); u16(c, 14, 33); u32(c, 16, crc); u32(c, 20, content.length); u32(c, 24, content.length); u16(c, 28, filename.length); u32(c, 42, offset); central.set(filename, 46);
    parts.push(header, content); directory.push(central); offset += header.length + content.length;
  }
  const directoryLength = directory.reduce((total, entry) => total + entry.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  u32(e, 0, 0x06054b50); u16(e, 8, directory.length); u16(e, 10, directory.length); u32(e, 12, directoryLength); u32(e, 16, offset);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
async function exportFormat(format) {
  if (!state.workflow || state.busy) return;
  const resultNode = $('export-result'); resultNode.className = 'export-result'; resultNode.textContent = 'Preparing your export…';
  for (const control of document.querySelectorAll('.export-option')) control.disabled = true;
  try {
    const data = await request('/api/export', { workflow: state.workflow, format });
    const files = data.files;
    if (!files || !Object.keys(files).length) throw new Error('No export files were returned.');
    if (format === 'skill') {
      const skillName = files['SKILL.md']?.match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1] || safeFilename(state.workflow.name).toLowerCase();
      const rooted = Object.fromEntries(Object.entries(files).map(([name, contents]) => [`${skillName}/${name}`, contents]));
      download(`${skillName}-skill.zip`, zipFiles(rooted));
    }
    else { const [filename, content] = Object.entries(files)[0]; download(safeFilename(filename.split('/').pop()), content, 'text/javascript'); }
    resultNode.replaceChildren(node('p', { text: format === 'skill' ? 'Agent skill ZIP downloaded. Extract the complete folder into your agent’s skills directory.' : 'Playwright script downloaded. See its header for installation and run instructions.' }));
    for (const [filename, content] of Object.entries(files)) resultNode.append(node('button', { type: 'button', class: 'export-file', text: `↓ ${filename}`, on: { click: () => download(safeFilename(filename.split('/').pop()), content) } }));
  } catch (error) { resultNode.className = 'export-result error'; resultNode.textContent = `Could not export. ${errorMessage(error)}`; }
  finally { for (const control of document.querySelectorAll('.export-option')) control.disabled = false; }
}

$('example-button').addEventListener('click', loadExample);
$('empty-example-button')?.addEventListener('click', loadExample);
$('import-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (event) => importFile(event.target.files[0]));
$('record-button').addEventListener('click', () => $('record-dialog').showModal());
$('record-form').addEventListener('submit', startRecording);
$('run-button').addEventListener('click', runWorkflow);
$('export-button').addEventListener('click', async () => { if (state.dirty && !await saveStep()) return; if (state.sourceDirty && !await applySource()) return; $('export-result').replaceChildren(); $('export-dialog').showModal(); });
$('export-json-button').addEventListener('click', downloadJSON);
$('download-json-button').addEventListener('click', downloadJSON);
$('export-playwright-button').addEventListener('click', () => exportFormat('playwright'));
$('export-skill-button').addEventListener('click', () => exportFormat('skill'));
$('parameter-form').addEventListener('submit', parameterize);
$('add-assertion-button').addEventListener('click', async () => { if (state.dirty && !await saveStep()) return; updateAssertionFields(); $('assertion-dialog').showModal(); });
$('assertion-form').addEventListener('submit', addAssertion);
$('assertion-kind').addEventListener('change', updateAssertionFields);
$('apply-source-button').addEventListener('click', applySource);
$('source-editor').addEventListener('input', () => { state.sourceDirty = true; $('apply-source-button').textContent = 'Validate & apply •'; });
$('save-origins-button').addEventListener('click', saveOrigins);
$('workflow-name').addEventListener('change', () => { if (!state.workflow) return; const name = $('workflow-name').value.trim(); if (!name) { $('workflow-name').value = state.workflow.name; return; } state.workflow.name = name; markUnrun(); $('source-editor').value = JSON.stringify(state.workflow, null, 2); document.title = `${name} · ReplaySmith`; renderSteps(); renderReport(); });
$('allow-sensitive').addEventListener('change', () => { if (state.report) { markUnrun(); renderSteps(); renderReport(); } });
for (const button of document.querySelectorAll('.dialog-close')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
for (const tab of document.querySelectorAll('.view-tab')) {
  tab.addEventListener('click', async () => { if (state.busy) return; if (state.dirty && !await saveStep()) return; switchView(tab.dataset.view); });
  tab.addEventListener('keydown', async (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); if (state.busy) return; if (state.dirty && !await saveStep()) return; const tabs = [...document.querySelectorAll('.view-tab')]; let index = tabs.indexOf(tab); index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; switchView(tabs[index].dataset.view); tabs[index].focus(); });
}
let dragDepth = 0;
document.addEventListener('dragenter', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth += 1; document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', (event) => { event.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const file = event.dataTransfer?.files[0]; if (file) importFile(file); });
updateAssertionFields(); setBusy(false); switchView('workflow');
try {
  const data = await request('/api/example'); applyWorkflow(unwrapWorkflow(data));
} catch (error) { showNotice(`The example is unavailable. You can still import a recording. ${errorMessage(error)}`, 'error'); }
