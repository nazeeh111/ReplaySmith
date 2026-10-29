import type { Candidate, ElementEvidence } from './types.js';
/** Deterministic, inspectable evidence score. No training or model/API calls. */
export function scoreEvidence(expected: ElementEvidence, actual: ElementEvidence): { score: number; reasons: string[] } {
  const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const words = (s: string) => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const similarity = (a: string, b: string) => {
    if (norm(a) === norm(b)) return 1;
    const aa = words(a), bb = words(b);
    if (!aa.size || !bb.size) return 0;
    const overlap = [...aa].filter(w => bb.has(w)).length;
    return overlap / new Set([...aa, ...bb]).size;
  };
  // Role/type conflicts disqualify candidates rather than being averaged away.
  if (expected.role && norm(expected.role) !== norm(actual.role)) return { score: 0, reasons: ['role conflicts'] };
  if (expected.type && norm(expected.type) !== norm(actual.type)) return { score: 0, reasons: ['input type conflicts'] };
  if (expected.role === 'heading' && /^h[1-6]$/.test(expected.tag ?? '') && expected.tag !== actual.tag) return { score: 0, reasons: ['heading level conflicts'] };
  const fields: [keyof ElementEvidence, number][] = [['name', 5], ['label', 5], ['testId', 5], ['text', 4], ['placeholder', 3], ['context', 4], ['href', 3], ['role', 1], ['tag', 0.5], ['type', 0.5]];
  let total = 0, earned = 0;
  const reasons: string[] = [];
  for (const [field, weight] of fields) {
    if (!norm(expected[field])) continue;
    total += weight;
    const a = expected[field]!, b = actual[field] ?? '';
    const match = ['name', 'text', 'label', 'context', 'placeholder'].includes(field) ? similarity(a, b) : +(norm(a) === norm(b));
    earned += weight * match;
    if (match > 0) reasons.push(`${field}: ${match === 1 ? 'exact' : `${Math.round(match * 100)}% token overlap`}`);
  }
  // A tag or role by itself is not enough evidence to recover.
  if (!['name', 'label', 'testId', 'text', 'placeholder', 'context', 'href'].some(k => norm(expected[k as keyof ElementEvidence]))) return { score: 0, reasons: ['insufficient identifying evidence'] };
  return { score: total ? Math.round(earned / total * 1000) / 1000 : 0, reasons };
}
export function rankCandidates(expected: ElementEvidence, candidates: ElementEvidence[]): Candidate[] {
  return candidates.map((evidence, index) => ({ evidence, index, ...scoreEvidence(expected, evidence) })).sort((a, b) => b.score - a.score || a.index - b.index);
}
export function chooseCandidate(candidates: Candidate[], threshold = 0.78, margin = 0.12): Candidate | undefined {
  const [first, second] = candidates;
  return first && first.score >= threshold && (!second || first.score - second.score >= margin) ? first : undefined;
}
