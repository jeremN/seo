import { describe, it, expect } from 'vitest';
import {
  SCHEMA, summarize, reportJson, errorJson, meetsThreshold, detailOf, renderHuman,
} from '../src/cli-render.js';
import type { Finding } from '../src/types.js';

const mk = (over: Partial<Finding>): Finding =>
  ({ path: '/', signal: 'title', severity: 'warning', before: null, after: null, message: 'msg', ...over });

const result = (findings: Finding[], over: { pageCount?: number; skipped?: string[] } = {}) =>
  ({ findings, pageCount: over.pageCount ?? findings.length, skipped: over.skipped ?? [] });

describe('summarize', () => {
  it('counts findings by severity', () => {
    const s = summarize([mk({ severity: 'critical' }), mk({ severity: 'warning' }), mk({ severity: 'warning' })]);
    expect(s).toEqual({ critical: 1, warning: 2, info: 0 });
  });
});

describe('reportJson', () => {
  it('emits the versioned report contract', () => {
    const findings = [mk({ severity: 'critical', path: '/x' })];
    const json = reportJson('audit', result(findings, { pageCount: 3, skipped: ['/y'] }));
    expect(json).toMatchObject({
      schema: SCHEMA,
      kind: 'report',
      command: 'audit',
      pageCount: 3,
      skipped: ['/y'],
      summary: { critical: 1, warning: 0, info: 0 },
      findings,
    });
  });
});

describe('errorJson', () => {
  it('emits the versioned error contract with a hint', () => {
    const json = errorJson('Sitemap introuvable', "seo-guard audit --url <url> --sitemap <url>", 3);
    expect(json).toEqual({
      schema: SCHEMA,
      kind: 'error',
      message: 'Sitemap introuvable',
      hint: 'seo-guard audit --url <url> --sitemap <url>',
      exitCode: 3,
    });
  });
});

describe('meetsThreshold', () => {
  const crit = [mk({ severity: 'critical' })];
  const warn = [mk({ severity: 'warning' })];
  it('critical threshold trips only on critical', () => {
    expect(meetsThreshold(crit, 'critical')).toBe(true);
    expect(meetsThreshold(warn, 'critical')).toBe(false);
  });
  it('warning threshold trips on warning or critical', () => {
    expect(meetsThreshold(warn, 'warning')).toBe(true);
    expect(meetsThreshold(crit, 'warning')).toBe(true);
  });
  it('none never trips', () => {
    expect(meetsThreshold(crit, 'none')).toBe(false);
  });
  it('empty findings never trip', () => {
    expect(meetsThreshold([], 'critical')).toBe(false);
  });
});

describe('detailOf', () => {
  it('renders a transition when before and after are present', () => {
    expect(detailOf(mk({ before: 'indexable', after: 'noindex (meta)' }))).toBe('indexable → noindex (meta)');
  });
  it('renders the after value alone when there is no before', () => {
    expect(detailOf(mk({ before: null, after: '404' }))).toBe('404');
  });
  it('falls back to the message when there is no before/after', () => {
    expect(detailOf(mk({ before: null, after: null, message: 'Title manquant.' }))).toBe('Title manquant.');
  });
});

describe('renderHuman', () => {
  it('shows a success line when there are no findings', () => {
    const out = renderHuman(result([], { pageCount: 5 }), { color: false });
    expect(out).toContain('✓');
    expect(out).toContain('5');
    expect(out).not.toContain('\x1b['); // no ANSI when color disabled
  });

  it('lists findings critical-first with no ANSI when color is off', () => {
    const out = renderHuman(
      result([mk({ severity: 'info', path: '/a' }), mk({ severity: 'critical', path: '/b' })]),
      { color: false },
    );
    expect(out).not.toContain('\x1b[');
    expect(out).toContain('/a');
    expect(out).toContain('/b');
    // critical row appears before info row
    expect(out.indexOf('/b')).toBeLessThan(out.indexOf('/a'));
  });

  it('emits ANSI colour codes when color is on', () => {
    const out = renderHuman(result([mk({ severity: 'critical', path: '/b' })]), { color: true });
    expect(out).toContain('\x1b[');
  });

  it('notes skipped pages in the summary', () => {
    const out = renderHuman(result([], { pageCount: 2, skipped: ['/down'] }), { color: false });
    expect(out).toContain('1'); // 1 skipped
  });
});
