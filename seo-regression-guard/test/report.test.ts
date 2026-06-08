import { describe, it, expect } from 'vitest';
import { report, MARKER } from '../src/report.js';
import type { Finding } from '../src/types.js';

const crit: Finding = { path: '/a', signal: 'indexability', severity: 'critical', before: 'indexable', after: 'noindex', message: '' };
const warn: Finding = { path: '/b', signal: 'title', severity: 'warning', before: 'T', after: null, message: '' };

describe('report', () => {
  it('aucun finding → message vert, shouldFail=false', () => {
    const r = report([], { failOn: 'critical', pageCount: 3 });
    expect(r.shouldFail).toBe(false);
    expect(r.markdown).toContain('Aucune régression');
    expect(r.markdown.startsWith(MARKER)).toBe(true);
  });

  it('fail-on=critical → fail seulement sur critical', () => {
    expect(report([crit], { failOn: 'critical', pageCount: 1 }).shouldFail).toBe(true);
    expect(report([warn], { failOn: 'critical', pageCount: 1 }).shouldFail).toBe(false);
  });

  it('fail-on=warning → fail sur warning ou critical', () => {
    expect(report([warn], { failOn: 'warning', pageCount: 1 }).shouldFail).toBe(true);
  });

  it('fail-on=none → ne fail jamais', () => {
    expect(report([crit], { failOn: 'none', pageCount: 1 }).shouldFail).toBe(false);
  });

  it('rend une table par sévérité avec le marqueur', () => {
    const r = report([crit, warn], { failOn: 'critical', pageCount: 2 });
    expect(r.markdown).toContain(MARKER);
    expect(r.markdown).toContain('`/a`');
    expect(r.markdown).toContain('`/b`');
  });

  it('échappe les `|` et retours ligne dans les cellules', () => {
    const piped: Finding = { path: '/p', signal: 'title', severity: 'warning', before: 'A | B\nC', after: null, message: '' };
    const r = report([piped], { failOn: 'critical', pageCount: 1 });
    expect(r.markdown).toContain('A \\| B C');
    expect(r.markdown).not.toContain('A | B');
  });
});
