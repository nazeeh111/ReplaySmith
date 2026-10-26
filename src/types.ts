/** Portable workflow format. Versioned, deterministic, and independent of a browser profile. */
export interface ElementEvidence {
  tag?: string;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  type?: string;
  href?: string;
  context?: string;
}
export interface Target {
  selectors: string[];
  evidence: ElementEvidence;
}
export interface Assertion {
  kind: 'visible' | 'text' | 'value' | 'url';
  target?: Target;
  value?: string;
}
export interface Step {
  id: string;
  action: 'navigate' | 'click' | 'fill' | 'select' | 'press' | 'assert';
  description?: string;
  url?: string;
  target?: Target;
  value?: string;
  key?: string;
  assertion?: Assertion;
  /** Consequential operations require exact targets and explicit run permission. */
  sensitive?: boolean;
}
export interface Workflow {
  version: 1;
  name: string;
  description?: string;
  inputs: Record<string, { default?: string; description?: string; secret?: boolean }>;
  allowedOrigins: string[];
  steps: Step[];
}
export interface Candidate {
  evidence: ElementEvidence;
  score: number;
  reasons: string[];
  index: number;
}
export interface StepResult {
  id: string;
  action: Step['action'];
  status: 'passed' | 'recovered' | 'abstained' | 'failed';
  durationMs: number;
  strategy?: 'selector' | 'semantic' | 'recovery';
  message?: string;
  candidates?: Candidate[];
}
export interface RunResult {
  workflow: string;
  status: 'passed' | 'abstained' | 'failed';
  verified: boolean;
  durationMs: number;
  steps: StepResult[];
}
export interface RunOptions {
  inputs?: Record<string,string>;
  headless?: boolean;
  allowSensitive?: boolean;
  timeoutMs?: number;
  recovery?: boolean;
  /** Restrict baseline resolution for reproducible comparisons. */
  strategy?: 'selector' | 'semantic' | 'heuristic' | 'recovery';
  onStep?: (result: StepResult) => void;
}
