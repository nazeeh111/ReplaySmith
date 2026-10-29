/**
 * Trusted, static browser-side extraction body shared by recording, replay and exports.
 * It approximates common accessible names; it is not the complete WAI-ARIA algorithm.
 * Keeping this as source text avoids capturing TypeScript loader helpers in page evaluation.
 * Input values are never collected, except the public label value of submit/button controls.
 */
export const elementEvidenceScript = String.raw`
  const compact = (value) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const attr = (key) => el.getAttribute(key) ?? '';
  const referencedText = (element, key) => (element.getAttribute(key) ?? '').split(/\s+/).filter(Boolean).map(id => compact(element.ownerDocument.getElementById(id)?.textContent)).join(' ');
  const tag = el.tagName.toLowerCase();
  const type = ['input', 'button'].includes(tag) ? el.type : '';
  const label = compact('labels' in el ? Array.from(el.labels ?? []).map(item => compact(item.textContent)).join(' ') : '');
  const text = ['input', 'textarea'].includes(tag) ? '' : compact(el.textContent);
  const implicitRole = tag === 'button' ? 'button'
    : tag === 'a' && el.hasAttribute('href') ? 'link'
    : tag === 'select' ? (el.multiple ? 'listbox' : 'combobox')
    : tag === 'textarea' ? 'textbox'
    : tag === 'input' ? (type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio'
      : ['button', 'submit', 'reset', 'image'].includes(type) ? 'button'
      : type === 'range' ? 'slider' : type === 'number' ? 'spinbutton'
      : ['hidden', 'password'].includes(type) ? '' : 'textbox')
    : tag === 'img' ? 'img' : /^h[1-6]$/.test(tag) ? 'heading' : '';
  const contentName = ['button', 'a'].includes(tag) || attr('role') || /^h[1-6]$/.test(tag)
    ? text || Array.from(el.querySelectorAll('img[alt]')).map(image => image.getAttribute('alt')).join(' ')
    : tag === 'img' || (tag === 'input' && type === 'image') ? attr('alt')
    : tag === 'input' && ['button', 'submit', 'reset'].includes(type) ? el.value : '';
  const name = compact(referencedText(el, 'aria-labelledby') || attr('aria-label') || label || contentName || attr('title') || attr('placeholder'));
  const region = el.closest('[data-replay-context],fieldset,form,section,article,tr,[role="group"]');
  const context = region ? compact(region.getAttribute('data-replay-context') || referencedText(region, 'aria-labelledby') || region.getAttribute('aria-label')
    || region.querySelector('legend,h1,h2,h3,h4,h5,h6')?.textContent
    || (region.tagName === 'TR' ? region.querySelector('th,td')?.textContent : '')) : '';
  const evidence = { tag, role: attr('role') || implicitRole, name, label, text, placeholder: attr('placeholder'), testId: attr('data-testid'), type, href: attr('href'), context };
  return Object.fromEntries(Object.entries(evidence).filter(([, value]) => value));
`;
