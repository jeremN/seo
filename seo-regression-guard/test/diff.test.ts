import { describe, it, expect } from 'vitest';
import { diff } from '../src/diff.js';
import type { SeoSignals } from '../src/types.js';

const sig = (over: Partial<SeoSignals>): SeoSignals => ({
  path: '/a', reachable: true, status: 200, redirectedTo: null,
  robots: { noindex: false, source: null }, canonical: 'https://x.com/a',
  title: 'T', metaDescription: 'D', h1: ['H'], jsonLd: [{ valid: true, types: ['Article'] }],
  ...over,
});

describe('diff', () => {
  it('aucune régression → []', () => {
    expect(diff(sig({}), sig({}))).toEqual([]);
  });

  it('noindex introduit → critical indexability', () => {
    const out = diff(sig({}), sig({ robots: { noindex: true, source: 'meta' } }));
    expect(out).toMatchObject([{ signal: 'indexability', severity: 'critical' }]);
  });

  it('page supprimée (200 → 404) → critical page-removed', () => {
    const out = diff(sig({}), sig({ status: 404 }));
    expect(out).toMatchObject([{ signal: 'page-removed', severity: 'critical' }]);
  });

  it('page nouvelle (prod 404) → info new-page, jamais bloquant', () => {
    const out = diff(sig({ status: 404 }), sig({}));
    expect(out).toMatchObject([{ signal: 'new-page', severity: 'info' }]);
  });

  it('200 → 5xx → critical status', () => {
    const out = diff(sig({}), sig({ status: 503 }));
    expect(out).toMatchObject([{ signal: 'status', severity: 'critical' }]);
  });

  it('redirection nouvelle → critical status', () => {
    const out = diff(sig({}), sig({ redirectedTo: 'https://x.com/b' }));
    expect(out).toMatchObject([{ signal: 'status', severity: 'critical' }]);
  });

  it('canonical supprimé → critical', () => {
    const out = diff(sig({}), sig({ canonical: null }));
    expect(out).toMatchObject([{ signal: 'canonical', severity: 'critical' }]);
  });

  it('canonical hors-domaine → critical, autre path on-site → warning', () => {
    const off = diff(sig({}), sig({ canonical: 'https://evil.com/a' }));
    expect(off).toMatchObject([{ signal: 'canonical', severity: 'critical' }]);
    const on = diff(sig({}), sig({ canonical: 'https://x.com/other' }));
    expect(on).toMatchObject([{ signal: 'canonical', severity: 'warning' }]);
  });

  it('title disparu → warning ; title modifié → info', () => {
    expect(diff(sig({}), sig({ title: null }))).toMatchObject([{ signal: 'title', severity: 'warning' }]);
    expect(diff(sig({}), sig({ title: 'Autre' }))).toMatchObject([{ signal: 'title', severity: 'info' }]);
  });

  it('meta description disparue → warning', () => {
    expect(diff(sig({}), sig({ metaDescription: null }))).toMatchObject([{ signal: 'meta-description', severity: 'warning' }]);
  });

  it('h1 disparu et multi-h1 → warning', () => {
    expect(diff(sig({}), sig({ h1: [] }))).toMatchObject([{ signal: 'h1', severity: 'warning' }]);
    expect(diff(sig({}), sig({ h1: ['a', 'b'] }))).toMatchObject([{ signal: 'h1', severity: 'warning' }]);
  });

  it('JSON-LD supprimé / invalidé → warning', () => {
    expect(diff(sig({}), sig({ jsonLd: [] }))).toMatchObject([{ signal: 'structured-data', severity: 'warning' }]);
    expect(diff(sig({}), sig({ jsonLd: [{ valid: false, types: [] }] }))).toMatchObject([{ signal: 'structured-data', severity: 'warning' }]);
  });

  it('paire non-reachable → [] (sautée)', () => {
    expect(diff(sig({ reachable: false }), sig({}))).toEqual([]);
    expect(diff(sig({}), sig({ reachable: false }))).toEqual([]);
  });
});
