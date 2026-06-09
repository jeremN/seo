import type { Finding, Severity } from './types.js';
import type { FailOn } from './report.js';

export const SCHEMA = 'seo-guard/v1';

const ORDER: Severity[] = ['critical', 'warning', 'info'];
const ICON: Record<Severity, string> = { critical: '🔴', warning: '🟡', info: 'ℹ️' };
const ANSI: Record<Severity, string> = { critical: '31', warning: '33', info: '36' };
const DETAIL_MAX = 80;

export interface Renderable {
  findings: Finding[];
  pageCount: number;
  skipped: string[];
}

export interface Summary {
  critical: number;
  warning: number;
  info: number;
}

export function summarize(findings: Finding[]): Summary {
  return {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
}

// Versioned, machine-readable report — the AX contract. Extra fields are allowed
// (forward-compatibility); consumers branch on `kind`.
export function reportJson(command: 'guard' | 'audit', result: Renderable) {
  return {
    schema: SCHEMA,
    kind: 'report' as const,
    command,
    pageCount: result.pageCount,
    skipped: result.skipped,
    summary: summarize(result.findings),
    findings: result.findings,
  };
}

export function errorJson(message: string, hint: string, exitCode: number) {
  return { schema: SCHEMA, kind: 'error' as const, message, hint, exitCode };
}

// Does any finding reach the failure threshold? `none` never fails; `warning`
// fails on warning-or-worse; `critical` (default) fails only on critical.
export function meetsThreshold(findings: Finding[], failOn: FailOn): boolean {
  if (failOn === 'none') return false;
  if (failOn === 'warning') return findings.some((f) => f.severity === 'critical' || f.severity === 'warning');
  return findings.some((f) => f.severity === 'critical');
}

// Compact human-readable detail for a finding. A diff finding is a transition
// (before → after); an absolute audit finding is usually a single state or a
// plain message. The full `message` always survives in --json regardless.
export function detailOf(f: Finding): string {
  if (f.before != null && f.after != null) return `${f.before} → ${f.after}`;
  if (f.after != null) return f.after;
  if (f.before != null) return f.before;
  return f.message;
}

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));

function summaryLine(result: Renderable): string {
  const s = summarize(result.findings);
  const parts = ORDER.filter((sev) => s[sev] > 0).map((sev) => `${ICON[sev]} ${s[sev]} ${sev}`);
  let line = `${parts.join(' · ')} — ${result.pageCount} page(s) analysée(s)`;
  if (result.skipped.length) line += `, ${result.skipped.length} ignorée(s)`;
  return line;
}

/**
 * Render findings as an aligned, critical-first table for human terminals.
 * Column widths are computed on the PLAIN text; colour is applied only after
 * padding so ANSI escapes never corrupt the alignment. `color: false` (NO_COLOR
 * or non-TTY) yields output with zero escape sequences.
 */
export function renderHuman(result: Renderable, opts: { color: boolean }): string {
  const { findings, pageCount, skipped } = result;
  if (findings.length === 0) {
    let line = `✓ aucun problème SEO sur ${pageCount} page(s)`;
    if (skipped.length) line += ` (${skipped.length} page(s) injoignable(s) ignorée(s))`;
    return line;
  }

  const sorted = [...findings].sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.path.localeCompare(b.path),
  );
  const headers = ['SEV', 'PAGE', 'SIGNAL', 'DETAIL'];
  const cells = sorted.map((f) => [f.severity, f.path, f.signal, truncate(detailOf(f), DETAIL_MAX)]);
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i].length)));

  const dim = (s: string) => (opts.color ? `\x1b[2m${s}\x1b[0m` : s);
  const colorSev = (sev: Severity, s: string) => (opts.color ? `\x1b[${ANSI[sev]}m${s}\x1b[0m` : s);

  const headerLine = dim(headers.map((h, i) => pad(h, widths[i])).join('  '));
  const bodyLines = sorted.map((f, idx) => {
    const r = cells[idx];
    const sev = colorSev(f.severity, pad(r[0], widths[0]));
    // DETAIL is the last column → no trailing pad needed
    return [sev, pad(r[1], widths[1]), pad(r[2], widths[2]), r[3]].join('  ');
  });

  return [headerLine, ...bodyLines, '', summaryLine(result)].join('\n');
}
