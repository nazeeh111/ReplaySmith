import { chromium, type Locator, type Page } from 'playwright';
import type { Candidate, ElementEvidence, RunOptions, RunResult, Step, StepResult, Target, Workflow } from './types.js';
import { validateWorkflow } from './workflow.js';
import { scoreEvidence } from './recovery.js';

/**
 * The portable runtime is also embedded in exported Playwright code.
 * Keep dependencies to scoreEvidence and standard globals only.
 */
export async function portableRuntime(page: Page, workflow: Workflow, options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const results: StepResult[] = [];
  const timeout = Math.max(100, Math.min(options.timeoutMs ?? 5000, 60000));
  const mode = options.strategy === 'heuristic' ? 'recovery' : options.strategy ?? (options.recovery === false ? 'semantic' : 'recovery');
  const inputValues: Record<string, string> = Object.create(null);
  for (const [key, spec] of Object.entries(workflow.inputs)) {
    const value = Object.hasOwn(options.inputs ?? {}, key) ? options.inputs![key] : spec.default;
    if (value === undefined) throw new Error(`Missing required input: ${key}`);
    if (typeof value !== 'string' || value.length > 16384) throw new Error(`Invalid input: ${key}`);
    inputValues[key] = value;
  }
  const interpolate = (s: string) => s.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(inputValues, key)) throw new Error(`Undeclared input: ${key}`);
    return inputValues[key]!;
  });
  const resolveTarget = (target: Target): Target => ({
    selectors: target.selectors.map(interpolate),
    evidence: Object.fromEntries(Object.entries(target.evidence).map(([k, v]) => [k, interpolate(v!)])),
  });
  const originAllowed = (url: string) => {
    try { const parsed = new URL(url); return !parsed.username && !parsed.password && ['http:', 'https:'].includes(parsed.protocol) && workflow.allowedOrigins.includes(parsed.origin); }
    catch { return false; }
  };
  let blockedNavigation = false;
  const routeGuard = async (route: import('playwright').Route) => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      let samePage = false;
      try { samePage = request.frame().page() === page; } catch { /* A popup's initial navigation may not have a frame yet. */ }
      if (!samePage || !originAllowed(request.url())) {
        blockedNavigation = true;
        try { await route.abort('blockedbyclient'); } catch { /* The blocked popup may already be closed. */ }
        return;
      }
      // Block HTTP redirects before the browser can follow an unchecked hop. Fulfilling the
      // response avoids issuing the navigation request twice (important for POSTs).
      let response: import('playwright').APIResponse;
      try { response = await route.fetch({ maxRedirects: 0, timeout }); }
      catch {
        blockedNavigation = true;
        try { await route.abort('failed'); } catch { /* Page already closed. */ }
        return;
      }
      const location = response.headers()['location'];
      if (response.status() >= 300 && response.status() < 400 && location) {
        blockedNavigation = true;
        await route.abort('blockedbyclient');
        return;
      }
      try { await route.fulfill({ response }); } catch { /* Page already closed. */ }
      return;
    }
    try { await route.continue(); } catch { /* Page already closed. */ }
  };
  const closePopup = (popup: Page) => { blockedNavigation = true; void popup.close(); };
  await page.context().route('**/*', routeGuard);
  page.on('popup', closePopup);
  // Derive a compact semantic fingerprint. No input values, HTML, or credentials are collected.
  const evidenceFor = async (locator: Locator): Promise<ElementEvidence> => locator.evaluate(new Function('el', `
    const compact = (s) => (s ?? '').replace(/\\s+/g, ' ').trim().slice(0, 600);
    const tag = el.tagName.toLowerCase();
    const attr = (key) => el.getAttribute(key) ?? '';
    const associated = 'labels' in el ? Array.from(el.labels ?? []).map(l => compact(l.textContent)).join(' ') : '';
    const referenced = attr('aria-labelledby').split(/\\s+/).filter(Boolean).map(id => compact(document.getElementById(id)?.textContent)).join(' ');
    const label = compact(associated);
    const text = compact(el.textContent);
    const type = ['input', 'button'].includes(tag) ? (el.type || (tag === 'button' ? 'submit' : 'text')) : '';
    const implicitRole = tag === 'button' ? 'button' : tag === 'a' && el.hasAttribute('href') ? 'link' : tag === 'select' ? (el.multiple ? 'listbox' : 'combobox') : tag === 'textarea' ? 'textbox' : tag === 'input' ? (type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : ['button', 'submit', 'reset'].includes(type) ? 'button' : ['number', 'range'].includes(type) ? (type === 'range' ? 'slider' : 'spinbutton') : ['hidden', 'password'].includes(type) ? '' : 'textbox') : tag === 'img' ? 'img' : /^h[1-6]$/.test(tag) ? 'heading' : '';
    const name = compact(referenced || attr('aria-label') || label || (tag === 'img' ? attr('alt') : ['button', 'a'].includes(tag) || attr('role') ? text : ['button', 'submit', 'reset'].includes(type) ? el.value : attr('placeholder')));
    const region = el.closest('[data-replay-context],fieldset,form,section,article,tr,[role="group"]');
    const context = region ? compact(region.getAttribute('data-replay-context') || region.getAttribute('aria-label') || region.querySelector(':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4')?.textContent || (region.tagName === 'TR' ? region.querySelector('th,td')?.textContent : '')) : '';
    const result = { tag, role: attr('role') || implicitRole, name, label, text, placeholder: attr('placeholder'), testId: attr('data-testid'), type, href: attr('href'), context };
    return Object.fromEntries(Object.entries(result).filter(([, v]) => v));
  `) as (el: Element) => ElementEvidence);
  const identifyingEvidence = (e: ElementEvidence) => ['name','text','label','placeholder','testId','context','href'].some(k => !!e[k as keyof ElementEvidence]);
  const compatible = async (locator: Locator, expected: ElementEvidence) => {
    if (await locator.count() !== 1 || !await locator.isVisible()) return false;
    if (!identifyingEvidence(expected)) return true;
    return scoreEvidence(expected, await evidenceFor(locator)).score >= 0.78;
  };
  const recordedLocator = (selector: string): Locator => {
    if (selector.startsWith('aria/')) {
      const match = selector.slice(5).match(/^(.*?)(?:\[role=["']?([^\]"']+)["']?\])?$/)!;
      return match[2] ? page.getByRole(match[2] as Parameters<Page['getByRole']>[0], { name: match[1], exact: true }) : page.getByRole('button', { name: match[1], exact: true }).or(page.getByRole('link', { name: match[1], exact: true })).or(page.getByLabel(match[1]!, { exact: true }));
    }
    if (selector.startsWith('text/')) return page.getByText(selector.slice(5), { exact: true });
    return page.locator(selector);
  };
  const resolveOnce = async (rawTarget: Target, action: Step['action'], sensitive: boolean): Promise<{ locator?: Locator; strategy?: StepResult['strategy']; candidates?: Candidate[]; message?: string }> => {
    const target = resolveTarget(rawTarget);
    const useSelectors = mode === 'selector' || mode === 'recovery';
    if (useSelectors) for (const selector of target.selectors) {
      try {
        const locator = recordedLocator(selector);
        // Every production strategy validates recorded identifying evidence.
        if (await compatible(locator, target.evidence)) return { locator, strategy: 'selector' };
      } catch { /* malformed/incompatible selector alternatives do not authorize a click */ }
    }
    if (sensitive) return { message: 'Consequential action requires one exact recorded selector with matching evidence; recovery is disabled.' };
    if (mode === 'selector') return { message: 'Recorded selector did not resolve to one visible element.' };
    const e = target.evidence;
    const semantic: Locator[] = [];
    if (e.role && e.name) semantic.push(page.getByRole(e.role as Parameters<Page['getByRole']>[0], { name: e.name, exact: true }));
    if (e.label) semantic.push(page.getByLabel(e.label, { exact: true }));
    if (e.testId) semantic.push(page.getByTestId(e.testId));
    if (e.placeholder) semantic.push(page.getByPlaceholder(e.placeholder, { exact: true }));
    if (e.text) semantic.push(page.getByText(e.text, { exact: true }));
    for (const locator of semantic) {
      try { if (await compatible(locator, e)) return { locator, strategy: 'semantic' }; } catch { /* candidate was ambiguous or changed */ }
    }
    if (mode === 'semantic') return { message: 'Semantic locator did not resolve unambiguously with matching evidence.' };
    // Enumerate only visible interaction targets. Assertions may locate generic elements by recorded tag.
    let query = action === 'fill' ? 'input:not([type="hidden"]),textarea,[contenteditable="true"]' : action === 'select' ? 'select' : 'button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[tabindex]';
    if (action === 'assert') query += ',[role="status"],[role="alert"],h1,h2,h3,p,output';
    if (e.tag && /^[a-z][a-z0-9-]*$/.test(e.tag)) query += `,${e.tag}`;
    const all = page.locator(query);
    const count = await all.count();
    if (count > 2000) return { message: 'Too many candidate elements; narrow the workflow target.' };
    const candidates: Candidate[] = [];
    for (let index = 0; index < count; index++) {
      const locator = all.nth(index);
      if (!await locator.isVisible()) continue;
      const actual = await evidenceFor(locator);
      const ranked = scoreEvidence(e, actual);
      candidates.push({ index, evidence: actual, ...ranked });
    }
    candidates.sort((a,b) => b.score - a.score || a.index - b.index);
    const top = candidates[0], next = candidates[1];
    if (!top || top.score < 0.78 || (next && top.score - next.score < 0.12)) return { message: !top || top.score < 0.78 ? 'Insufficient evidence for recovery (minimum score 0.78).' : 'Recovery is ambiguous (minimum lead 0.12); no action taken.', candidates: candidates.slice(0,5) };
    return { locator: all.nth(top.index), strategy: 'recovery', candidates: candidates.slice(0,5) };
  };
  const resolve = async (target: Target, action: Step['action'], sensitive: boolean) => {
    const deadline = Date.now() + timeout;
    let resolved = await resolveOnce(target, action, sensitive);
    while (!resolved.locator && !resolved.message?.includes('ambiguous') && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
      resolved = await resolveOnce(target, action, sensitive);
    }
    return resolved;
  };
  const sensitiveWords = /\b(pay|purchase|buy|delete|remove|send|publish|transfer|confirm order|place order|submit|checkout)\b/i;
  let finalStatus: RunResult['status'] = 'passed';
  try {
    for (const step of workflow.steps) {
      const stepStarted = Date.now();
      let result: StepResult = { id: step.id, action: step.action, status: 'passed', durationMs: 0 };
      try {
        if (step.action !== 'navigate' && !originAllowed(page.url())) throw new Error('origin');
        if (blockedNavigation) throw new Error('origin');
        if (step.action === 'navigate') {
          const url = interpolate(step.url!);
          if (!originAllowed(url)) throw new Error('origin');
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
          if (!originAllowed(page.url()) || blockedNavigation) throw new Error('origin');
        } else if (step.action === 'assert' && step.assertion?.kind === 'url') {
          const expected = interpolate(step.assertion.value!);
          await page.waitForURL(url => url.href === expected, { timeout });
        } else {
          const aim = step.action === 'assert' ? step.assertion!.target! : step.target!;
          const requested = resolveTarget(aim).evidence;
          const sensitive = step.sensitive === true || (step.action !== 'assert' && (requested.type === 'password' || sensitiveWords.test(`${requested.name ?? ''} ${requested.text ?? ''} ${step.description ?? ''}`)));
          if (sensitive && !options.allowSensitive) {
            result = { ...result, status: 'abstained', message: 'Consequential action requires explicit allowSensitive permission.' };
          } else {
            const resolved = await resolve(aim, step.action, sensitive);
            result.strategy = resolved.strategy;
            if (resolved.candidates) result.candidates = resolved.candidates;
            if (!resolved.locator) result = { ...result, status: 'abstained', message: resolved.message };
            else {
              const locator = resolved.locator;
              const actual = await evidenceFor(locator);
              const resolvedKey = step.action === 'press' ? interpolate(step.key!) : '';
              const actionContext = ['press', 'click'].includes(step.action) ? await locator.evaluate((el, action) => {
                // Native activation bubbles from nested spans/icons to the owning control.
                const control = el.closest('button,input[type="submit"],input[type="image"],a[href],[role="button"],[role="link"]') as HTMLButtonElement | HTMLInputElement | HTMLAnchorElement | null;
                const field = el.closest('input,select,textarea,button') as HTMLInputElement | null;
                const form = (field && field.form) || (control && 'form' in control && control.form) || el.closest('form');
                const type = control && 'type' in control ? control.type : '';
                return {
                  formAssociated: !!form,
                  submitControl: action === 'click' && !!form && ['submit', 'image'].includes(type),
                  controlText: control?.getAttribute('aria-label') || control?.textContent || (control && 'value' in control ? control.value : '') || '',
                };
              }, step.action) : {formAssociated: false, submitControl: false, controlText: ''};
              const submitsForm = actionContext.submitControl || (step.action === 'press' && actionContext.formAssociated && /(?:^|\+)Enter$/.test(resolvedKey));
              const actualSensitive = step.action !== 'assert' && (submitsForm || actual.type === 'password' || sensitiveWords.test(`${actual.name ?? ''} ${actual.text ?? ''} ${actionContext.controlText}`));
              if (step.action !== 'assert' && (!await locator.isEnabled() || (['fill','select'].includes(step.action) && !await locator.isEditable()))) result = { ...result, status: 'abstained', message: 'Target is disabled or not editable; no action taken.' };
              else if (actualSensitive && (!options.allowSensitive || resolved.strategy !== 'selector')) result = { ...result, status: 'abstained', message: 'Detected consequential target or form submission; explicit permission and an exact selector are required.' };
              else {
                if (step.action === 'click') await locator.click({ timeout });
                else if (step.action === 'fill') {
                  if (actual.tag === 'select') await locator.selectOption(interpolate(step.value!), { timeout });
                  else await locator.fill(interpolate(step.value!), { timeout });
                } else if (step.action === 'select') await locator.selectOption(interpolate(step.value!), { timeout });
                else if (step.action === 'press') await locator.press(resolvedKey, { timeout });
                else if (step.action === 'assert') {
                  const assertion = step.assertion!;
                  const expected = interpolate(assertion.value ?? '');
                  const deadline = Date.now() + timeout;
                  let matched = false;
                  do {
                    if (assertion.kind === 'visible') matched = await locator.isVisible();
                    else if (assertion.kind === 'text') matched = (await locator.innerText({ timeout })).replace(/\s+/g,' ').trim() === expected.replace(/\s+/g,' ').trim();
                    else if (assertion.kind === 'value') matched = await locator.inputValue({ timeout }) === expected;
                    if (matched) break;
                    await new Promise(resolve => setTimeout(resolve, 50));
                  } while (Date.now() < deadline);
                  if (!matched) throw new Error('assertion');
                }
                if (step.action !== 'assert' && resolved.strategy !== 'selector') result.status = 'recovered';
                if (blockedNavigation || !originAllowed(page.url())) throw new Error('origin');
              }
            }
          }
        }
      } catch (error) {
        const cause = error instanceof Error ? error.message : '';
        // Do not echo Playwright call logs, which can include secret input values.
        result = { ...result, status: 'failed', message: cause === 'origin' ? 'Blocked navigation, unsupported HTTP redirect, or action outside allowedOrigins.' : cause === 'assertion' ? 'Outcome assertion did not match within the timeout.' : `Browser ${step.action} failed or timed out; inspect the workflow target and page state.` };
      }
      if (result.candidates) {
        const privateValues = Object.entries(workflow.inputs).filter(([, spec]) => spec.secret).map(([key]) => inputValues[key]).filter(Boolean);
        for (const candidate of result.candidates) for (const field of Object.keys(candidate.evidence) as (keyof ElementEvidence)[]) {
          let value = candidate.evidence[field]!;
          for (const privateValue of privateValues) value = value.split(privateValue).join('[redacted]');
          candidate.evidence[field] = value;
        }
      }
      result.durationMs = Date.now() - stepStarted;
      results.push(result);
      options.onStep?.(result);
      if (result.status === 'abstained' || result.status === 'failed') { finalStatus = result.status; break; }
    }
  } finally {
    page.off('popup', closePopup);
    await page.context().unroute('**/*', routeGuard);
  }
  const lastAction = workflow.steps.map(s => s.action !== 'assert').lastIndexOf(true);
  const outcomeAssertions = workflow.steps.slice(lastAction + 1).filter(s => s.action === 'assert').length;
  return { workflow: workflow.name, status: finalStatus, verified: finalStatus === 'passed' && outcomeAssertions > 0, durationMs: Date.now() - started, steps: results };
}

export async function runOnPage(page: Page, workflow: Workflow, options: RunOptions = {}): Promise<RunResult> {
  return portableRuntime(page, validateWorkflow(workflow), options);
}
export async function runWorkflow(workflow: Workflow, options: RunOptions = {}): Promise<RunResult> {
  const validated = validateWorkflow(workflow);
  const browser = await chromium.launch({ headless: options.headless !== false });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    return await portableRuntime(page, validated, options);
  } finally { await browser.close(); }
}
