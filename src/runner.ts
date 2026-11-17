import { chromium, type Locator, type Page } from 'playwright';
import type { Candidate, ElementEvidence, RunOptions, RunResult, Step, StepResult, Target, Workflow } from './types.js';
import { validateWorkflow } from './workflow.js';
import { scoreEvidence } from './recovery.js';
import { elementEvidenceScript } from './evidence.js';

/**
 * The portable runtime is also embedded in exported Playwright code.
 * Keep dependencies to scoreEvidence, elementEvidenceScript and standard globals only.
 */
export async function portableRuntime(page: Page, workflow: Workflow, options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const results: StepResult[] = [];
  if (!Number.isFinite(options.timeoutMs ?? 5000)) throw new Error('timeoutMs must be a finite number.');
  const timeout = Math.max(100, Math.min(options.timeoutMs ?? 5000, 60000));
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  let deadline = Infinity;
  const remaining = (until = deadline) => {
    if (signal.aborted) throw new Error('cancelled');
    const left = Math.min(timeout, until - performance.now());
    // Playwright treats zero as no timeout, not as an expired operation.
    if (left <= 0) throw new Error('deadline');
    return Math.ceil(left);
  };
  const browserOptions = () => ({ timeout: remaining(), signal });
  const pause = async () => {
    const delay = Math.min(50, remaining());
    await new Promise<void>((resolve, reject) => {
      const done = () => { options.signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(done, delay);
      const cancel = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
        reject(new Error('cancelled'));
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
    });
    remaining();
  };
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
  let routingStopped = false;
  const handlers = new Set<Promise<void>>();
  const guardRequest = async (route: import('playwright').Route) => {
    const requestDeadline = deadline;
    const abort = async () => { try { await route.abort('failed'); } catch { /* Page already closed. */ } };
    if (routingStopped) { await abort(); return; }
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
      let response: import('playwright').APIResponse | undefined;
      try {
        response = await route.fetch({ maxRedirects: 0, timeout: remaining(requestDeadline), signal });
        remaining(requestDeadline);
        if (routingStopped) throw new Error('cancelled');
        const location = response.headers()['location'];
        if (response.status() >= 300 && response.status() < 400 && location) {
          blockedNavigation = true;
          await route.abort('blockedbyclient');
          return;
        }
        await route.fulfill({ response });
      } catch {
        blockedNavigation = true;
        await abort();
      } finally {
        try { await response?.dispose(); } catch { /* Context already closed. */ }
      }
      return;
    }
    try { await route.continue(); } catch { /* Page already closed. */ }
  };
  const routeGuard = async (route: import('playwright').Route) => {
    const pending = guardRequest(route);
    handlers.add(pending);
    try { await pending; } finally { handlers.delete(pending); }
  };
  const closePopup = (popup: Page) => { blockedNavigation = true; void popup.close(); };
  await page.context().route('**/*', routeGuard);
  page.on('popup', closePopup);
  const evidenceFor = async (locator: Locator): Promise<ElementEvidence> => {
    const evidence = await locator.evaluate(new Function('el', elementEvidenceScript) as (el: Element) => ElementEvidence, undefined, browserOptions());
    remaining();
    return evidence;
  };
  const identifyingEvidence = (e: ElementEvidence) => ['name','text','label','placeholder','testId','context','href'].some(k => !!e[k as keyof ElementEvidence]);
  const matches = (actual: ElementEvidence, expected: ElementEvidence) => {
    const normalize = (value: string | undefined) => (value ?? '').toLowerCase().trim();
    if (expected.role && normalize(expected.role) !== normalize(actual.role)) return false;
    if (expected.type && normalize(expected.type) !== normalize(actual.type)) return false;
    if (expected.role === 'heading' && /^h[1-6]$/.test(expected.tag ?? '') && expected.tag !== actual.tag) return false;
    if (!identifyingEvidence(expected)) return true;
    return scoreEvidence(expected, actual).score >= 0.78;
  };
  const compatible = async (locator: Locator, expected: ElementEvidence) => {
    remaining();
    if (await locator.count() !== 1 || !await locator.isVisible()) return false;
    return matches(await evidenceFor(locator), expected);
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
    remaining();
    const target = resolveTarget(rawTarget);
    const useSelectors = mode === 'selector' || mode === 'recovery';
    if (useSelectors) for (const selector of target.selectors) {
      try {
        const locator = recordedLocator(selector);
        // Every production strategy validates recorded identifying evidence.
        if (await compatible(locator, target.evidence)) return { locator, strategy: 'selector' };
      } catch { remaining(); /* malformed/incompatible selector alternatives do not authorize a click */ }
    }
    if (sensitive) return { message: 'Consequential action requires one exact recorded selector with matching evidence; recovery is disabled.' };
    if (mode === 'selector') return { message: 'Recorded selector did not resolve to one visible element.' };
    const e = target.evidence;
    const semantic: Locator[] = [];
    if (e.role === 'heading' && /^h[1-6]$/.test(e.tag ?? '') && identifyingEvidence(e)) semantic.push(page.getByRole('heading', { level: Number(e.tag!.slice(1)) }));
    if (e.role && e.name) semantic.push(page.getByRole(e.role as Parameters<Page['getByRole']>[0], { name: e.name, exact: true }));
    if (e.label) semantic.push(page.getByLabel(e.label, { exact: true }));
    if (e.testId) semantic.push(page.getByTestId(e.testId));
    if (e.placeholder) semantic.push(page.getByPlaceholder(e.placeholder, { exact: true }));
    if (e.text) semantic.push(page.getByText(e.text, { exact: true }));
    for (const locator of semantic) {
      remaining();
      try { if (await compatible(locator, e)) return { locator, strategy: 'semantic' }; } catch { remaining(); /* candidate was ambiguous or changed */ }
    }
    if (mode === 'semantic') return { message: 'Semantic locator did not resolve unambiguously with matching evidence.' };
    // Enumerate only visible interaction targets. Assertions may locate generic elements by recorded tag.
    let query = action === 'fill' ? 'input:not([type="hidden"]),textarea,[contenteditable="true"]' : action === 'select' ? 'select' : 'button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[tabindex]';
    if (action === 'assert') query += ',[role="status"],[role="alert"],h1,h2,h3,p,output';
    if (e.tag && /^[a-z][a-z0-9-]*$/.test(e.tag)) query += `,${e.tag}`;
    const all = page.locator(query);
    const count = await all.count();
    if (count > 2000) return { message: 'Too many candidate elements; narrow the workflow target.' };
    remaining();
    // Keep Playwright's visibility semantics, but extract the complete visible pool in
    // one browser round trip. Compile the trusted source in Node so strict CSP pages
    // receive an ordinary function, with no page-side eval or Function constructor.
    const visible = all.filter({ visible: true });
    const pool = await visible.evaluateAll(new Function('elements', `return elements.map(function(el) {${elementEvidenceScript}\n});`) as (elements: Element[]) => ElementEvidence[]);
    remaining();
    if (pool.length > 2000) return { message: 'Too many candidate elements; narrow the workflow target.' };
    const candidates: Candidate[] = [];
    for (let index = 0; index < pool.length; index++) {
      // Never choose a winner from a partially inspected pool.
      remaining();
      const actual = pool[index];
      const ranked = scoreEvidence(e, actual);
      candidates.push({ index, evidence: actual, ...ranked });
    }
    candidates.sort((a,b) => b.score - a.score || a.index - b.index);
    remaining();
    const top = candidates[0], next = candidates[1];
    if (!top || top.score < 0.78 || (next && top.score - next.score < 0.12)) return { message: !top || top.score < 0.78 ? 'Insufficient evidence for recovery (minimum score 0.78).' : 'Recovery is ambiguous (minimum lead 0.12); no action taken.', candidates: candidates.slice(0,5) };
    return { locator: visible.nth(top.index), strategy: 'recovery', candidates: candidates.slice(0,5) };
  };
  const resolve = async (target: Target, action: Step['action'], sensitive: boolean) => {
    let resolved = await resolveOnce(target, action, sensitive);
    while (!resolved.locator && !resolved.message?.includes('ambiguous')) {
      await pause();
      resolved = await resolveOnce(target, action, sensitive);
    }
    remaining();
    return resolved;
  };
  const waitForReady = async (locator: Locator, expected: ElementEvidence, action: Step['action']): Promise<string | undefined> => {
    while (true) {
      remaining();
      if (blockedNavigation || !originAllowed(page.url())) throw new Error('origin');
      // A selector can be reused while an asynchronous control is loading. Never wait
      // through an identity change and then act on the replacement by accident.
      if (!await compatible(locator, expected)) return 'target-changed';
      if (await locator.isEnabled(browserOptions()) && (!['fill', 'select'].includes(action) || await locator.isEditable(browserOptions()))) {
        remaining();
        return;
      }
      await pause();
    }
  };
  const sensitiveWords = /\b(pay|purchase|buy|delete|remove|send|publish|transfer|confirm order|place order|submit|checkout)\b/i;
  const performOwnedAction = async (locator: Locator, expected: ElementEvidence, step: Step, strategy: StepResult['strategy'], dispatched: () => void) => {
    const key = step.action === 'press' ? interpolate(step.key!) : '';
    const owner = await locator.elementHandle(browserOptions());
    if (!owner) throw new Error('target-changed');
    const stopped = new AbortController();
    const actionSignal = AbortSignal.any([signal, stopped.signal]);
    // A fresh locator identity makes removal independent of caller-owned handlers.
    // Any visible element triggers the native precheck, even if the owned node's
    // original selector no longer matches after a same-node identity change.
    const trigger = page.locator(':visible').first().filter({ hasNot: page.locator(`[data-replaysmith-${crypto.randomUUID()}]`) });
    let registered = false;
    let closing = false;
    let ownershipError: unknown;
    let selectElement = false;
    const checks = new Set<Promise<void>>();
    const validateOwner = async () => {
      remaining();
      if (blockedNavigation || !originAllowed(page.url())) throw new Error('origin');
      const actual = await owner.evaluate(new Function('el', elementEvidenceScript) as (el: Element) => ElementEvidence);
      remaining();
      selectElement = actual.tag === 'select';
      const context = await owner.evaluate((el, action) => {
        // Native activation bubbles from nested spans/icons to the owning control.
        const control = el.closest('button,input[type="submit"],input[type="image"],a[href],[role="button"],[role="link"]') as HTMLButtonElement | HTMLInputElement | null;
        const field = el.closest('input,select,textarea,button') as HTMLInputElement | null;
        const form = (field && field.form) || (control && 'form' in control && control.form) || el.closest('form');
        return {
          connected: el.isConnected,
          formAssociated: !!form,
          submitControl: action === 'click' && !!form && !!control && ['submit', 'image'].includes(control.type),
          controlText: control?.getAttribute('aria-label') || control?.textContent || (control && 'value' in control ? control.value : '') || '',
        };
      }, step.action);
      remaining();
      if (!context.connected) throw new Error('owner-unobservable');
      if (!matches(actual, expected)) throw new Error('target-changed');
      const submits = context.submitControl || (step.action === 'press' && context.formAssociated && /(?:^|\+)Enter$/.test(key));
      const consequential = submits || actual.type === 'password' || sensitiveWords.test(`${actual.name ?? ''} ${actual.text ?? ''} ${context.controlText}`);
      if (consequential && (!options.allowSensitive || strategy !== 'selector')) throw new Error('consequential');
    };
    const guard = async () => {
      if (closing) return;
      const pending = validateOwner();
      checks.add(pending);
      try { await pending; } catch (error) { ownershipError = error; stopped.abort(); }
      finally { checks.delete(pending); }
    };
    try {
      await validateOwner();
      await page.addLocatorHandler(trigger, guard, { noWaitAfter: true });
      registered = true;
      if (step.action === 'press') await validateOwner();
      const actionOptions = { timeout: remaining(), signal: actionSignal };
      const actionUrl = page.url();
      dispatched();
      // Handles cannot re-resolve a replacement. Native prechecks revalidate the
      // same node during click/fill/select retries; press has no inner retry loop.
      if (step.action === 'click') await owner.click(actionOptions);
      else if (step.action === 'fill') {
        if (selectElement) await owner.selectOption(interpolate(step.value!), actionOptions);
        else await owner.fill(interpolate(step.value!), actionOptions);
      } else if (step.action === 'select') await owner.selectOption(interpolate(step.value!), actionOptions);
      else if (step.action === 'press') await owner.press(key, actionOptions);
      remaining();
      // A separate post-dispatch observation can detect drift but cannot prevent
      // an effect or prove identity was stable during the native action.
      let observation: 'matched' | 'changed' | 'unobservable' = 'unobservable';
      if (page.url() === actionUrl) {
        let connected = false;
        try { connected = await owner.evaluate(el => el.isConnected); } catch { /* Navigation or detachment may make the owner unavailable. */ }
        remaining();
        if (connected) {
          try { await validateOwner(); observation = 'matched'; }
          catch (error) {
            remaining();
            if (error instanceof Error && (error.message === 'target-changed' || error.message === 'consequential'))
              observation = 'changed';
            // Execution context loss is not evidence of a changed identity.
          }
        }
      }
      return observation;
    } catch (error) {
      throw ownershipError ?? error;
    } finally {
      closing = true;
      stopped.abort();
      try { if (registered) await page.removeLocatorHandler(trigger); }
      finally { await Promise.allSettled([...checks]); await owner.dispose(); }
    }
  };
  let finalStatus: RunResult['status'] = 'passed';
  // Assertions can describe the resulting page but cannot clear this uncertainty.
  let uncertainAction: { id: string; observation: 'changed' | 'unobservable' } | undefined;
  try {
    for (const step of workflow.steps) {
      const stepStarted = Date.now();
      deadline = performance.now() + timeout;
      let actionStarted = false;
      let assertionStarted = false;
      let result: StepResult = { id: step.id, action: step.action, status: 'passed', durationMs: 0 };
      try {
        remaining();
        if (uncertainAction && step.action !== 'assert') {
          result = { ...result, status: 'abstained', message: `An earlier action (${uncertainAction.id}) was dispatched and its target identity was ${uncertainAction.observation}; this action was not taken. Inspect page state before continuing.` };
        } else if (step.action !== 'navigate' && !originAllowed(page.url())) throw new Error('origin');
        if (result.status === 'abstained') { /* Preserve the uncertainty barrier without dispatching this step. */ }
        else if (blockedNavigation) throw new Error('origin');
        else if (step.action === 'navigate') {
          const url = interpolate(step.url!);
          if (!originAllowed(url)) throw new Error('origin');
          const actionOptions = browserOptions();
          actionStarted = true;
          await page.goto(url, { waitUntil: 'domcontentloaded', ...actionOptions });
          remaining();
          if (!originAllowed(page.url()) || blockedNavigation) throw new Error('origin');
        } else if (step.action === 'assert' && step.assertion?.kind === 'url') {
          const expected = interpolate(step.assertion.value!);
          assertionStarted = true;
          await page.waitForURL(url => url.href === expected, browserOptions());
          remaining();
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
              if (step.action !== 'assert') {
                const unavailable = await waitForReady(locator, requested, step.action);
                if (unavailable) throw new Error(unavailable);
              }
              if (step.action !== 'assert') {
                const observation = await performOwnedAction(locator, requested, step, resolved.strategy, () => { actionStarted = true; });
                result.identityObservation = observation;
                if (observation !== 'matched') uncertainAction = { id: step.id, observation };
                result.message = observation === 'matched'
                  ? 'Target evidence matched after dispatch; this does not prove identity at dispatch.'
                  : observation === 'changed'
                    ? 'Target evidence changed after dispatch. This may be an expected effect or indicate a wrong action; inspect page state. Outcome checks do not prove target identity.'
                    : 'Target identity was not observable after dispatch; outcome assertions do not prove target identity.';
              } else if (!await compatible(locator, requested)) {
                result = { ...result, status: 'abstained', message: 'Target identity changed before the action; no action taken.' };
              } else {
                assertionStarted = true;
                const assertion = step.assertion!;
                const expected = interpolate(assertion.value ?? '');
                let matched = false;
                do {
                  remaining();
                  if (assertion.kind === 'visible') matched = await locator.isVisible();
                  else if (assertion.kind === 'text') matched = ((await locator.textContent(browserOptions())) ?? '').replace(/\s+/g,' ').trim() === expected.replace(/\s+/g,' ').trim();
                  else if (assertion.kind === 'value') matched = await locator.inputValue(browserOptions()) === expected;
                  else if (assertion.kind === 'checked' || assertion.kind === 'unchecked') {
                    const state = await locator.evaluate(el => {
                      if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) throw new Error('Expected a native checkbox or radio input');
                      return { checked: el.checked, indeterminate: el.indeterminate };
                    }, undefined, browserOptions());
                    matched = !state.indeterminate && state.checked === (assertion.kind === 'checked');
                  }
                  remaining();
                  if (matched) break;
                  await pause();
                } while (!matched);
              }
              remaining();
              if (step.action !== 'assert' && resolved.strategy !== 'selector') result.status = 'recovered';
              if (blockedNavigation || !originAllowed(page.url())) throw new Error('origin');
            }
          }
        }
      } catch (error) {
        const cause = options.signal?.aborted ? 'cancelled' : performance.now() >= deadline ? 'deadline' : error instanceof Error ? error.message : '';
        // Do not echo Playwright call logs, which can include secret input values.
        const stopped = cause === 'deadline' || cause === 'cancelled';
        const abstained = cause === 'target-changed' || (cause === 'owner-unobservable' && !actionStarted) || cause === 'consequential' || (stopped && !actionStarted && !assertionStarted) || (cause === 'cancelled' && !actionStarted);
        const stopMessage = cause === 'cancelled' ? 'Operation cancelled' : 'Operation time budget exhausted';
        result = { ...result, status: abstained ? 'abstained' : 'failed', message: stopped ? `${stopMessage}; ${actionStarted ? 'an action was already dispatched; inspect page state before retrying.' : 'no action taken.'}` : cause === 'target-changed' ? 'Target identity changed while waiting; no action taken.' : cause === 'consequential' ? 'Detected consequential target or form submission; explicit permission and an exact selector are required.' : cause === 'origin' ? 'Blocked navigation, unsupported HTTP redirect, or action outside allowedOrigins.' : `Browser ${step.action} failed or timed out; inspect the workflow target and page state.` };
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
    routingStopped = true;
    lifetime.abort();
    page.off('popup', closePopup);
    try { await page.context().unroute('**/*', routeGuard); }
    finally { while (handlers.size) await Promise.allSettled([...handlers]); }
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
