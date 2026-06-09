import { describe, it, expect } from 'vitest';
import { audit } from '../src/audit.js';
import type { FetchResult } from '../src/fetcher.js';

const res = (over: Partial<FetchResult>): FetchResult =>
  ({ ok: true, status: 200, headers: {}, html: '', finalUrl: '', ...over });

// Minimal HTML page builder for the lint fixtures.
function page(opts: {
  title?: string;
  meta?: string;
  h1?: number;
  noindex?: boolean;
  jsonld?: 'valid' | 'invalid';
  links?: string[];
} = {}): string {
  const parts: string[] = [];
  if (opts.noindex) parts.push('<meta name="robots" content="noindex">');
  if (opts.title) parts.push(`<title>${opts.title}</title>`);
  if (opts.meta) parts.push(`<meta name="description" content="${opts.meta}">`);
  for (let i = 0; i < (opts.h1 ?? 0); i++) parts.push(`<h1>h${i}</h1>`);
  if (opts.jsonld === 'valid') parts.push('<script type="application/ld+json">{"@type":"WebPage"}</script>');
  if (opts.jsonld === 'invalid') parts.push('<script type="application/ld+json">{not json</script>');
  for (const l of opts.links ?? []) parts.push(`<a href="${l}">x</a>`);
  return parts.join('');
}

// Serves a fixed map of pathname → FetchResult; robots.txt is always empty (allow all).
function serve(pages: Record<string, FetchResult>): (url: string) => Promise<FetchResult> {
  return (url: string) => {
    if (url.endsWith('/robots.txt')) return Promise.resolve(res({ html: '' }));
    const p = new URL(url).pathname;
    return Promise.resolve(pages[p] ?? res({ status: 404, finalUrl: url }));
  };
}

const URL_BASE = 'https://site.example';
const sigsOf = (findings: { signal: string; path: string }[]) =>
  findings.map((f) => `${f.signal}:${f.path}`);

describe('audit', () => {
  it('flags absolute per-page issues (noindex, missing title/meta, bad h1, invalid json-ld)', async () => {
    const fetchImpl = serve({
      '/': res({ html: page({ title: 'Home', meta: 'd', h1: 1, jsonld: 'valid', links: ['/nometa', '/noindex', '/noh1', '/multih1', '/badld', '/notitle'] }), finalUrl: `${URL_BASE}/` }),
      '/nometa': res({ html: page({ title: 'A', h1: 1, links: ['/'] }), finalUrl: `${URL_BASE}/nometa` }),
      '/noindex': res({ html: page({ title: 'N', meta: 'd', h1: 1, noindex: true, links: ['/'] }), finalUrl: `${URL_BASE}/noindex` }),
      '/noh1': res({ html: page({ title: 'NoH1', meta: 'd', h1: 0, links: ['/'] }), finalUrl: `${URL_BASE}/noh1` }),
      '/multih1': res({ html: page({ title: 'Multi', meta: 'd', h1: 2, links: ['/'] }), finalUrl: `${URL_BASE}/multih1` }),
      '/badld': res({ html: page({ title: 'Bad', meta: 'd', h1: 1, jsonld: 'invalid', links: ['/'] }), finalUrl: `${URL_BASE}/badld` }),
      '/notitle': res({ html: page({ meta: 'd', h1: 1, links: ['/'] }), finalUrl: `${URL_BASE}/notitle` }),
    });
    const out = await audit({
      url: URL_BASE, paths: ['/', '/nometa', '/noindex', '/noh1', '/multih1', '/badld', '/notitle'],
      maxPages: 50, fetchImpl,
    });
    const sigs = sigsOf(out.findings);
    expect(sigs).toContain('meta-description:/nometa');
    expect(sigs).toContain('indexability:/noindex');
    expect(sigs).toContain('h1:/noh1');
    expect(sigs).toContain('h1:/multih1');
    expect(sigs).toContain('structured-data:/badld');
    expect(sigs).toContain('title:/notitle');
    // every page is linked from / → no orphans, including root
    expect(sigs.filter((s) => s.startsWith('orphan-page'))).toEqual([]);
    // a fully-valid page produces no finding
    expect(sigs.filter((s) => s.endsWith(':/'))).toEqual([]);
    expect(out.pageCount).toBe(7);
  });

  it('audit flags noindex as a warning (not critical like guard)', async () => {
    const fetchImpl = serve({
      '/': res({ html: page({ title: 'H', meta: 'd', h1: 1, noindex: true }), finalUrl: `${URL_BASE}/` }),
    });
    const out = await audit({ url: URL_BASE, paths: ['/'], maxPages: 50, fetchImpl });
    const idx = out.findings.find((f) => f.signal === 'indexability');
    expect(idx?.severity).toBe('warning');
  });

  it('flags non-2xx pages as critical status and skips content lints on them', async () => {
    const fetchImpl = serve({
      '/': res({ html: page({ title: 'H', meta: 'd', h1: 1, links: ['/broken'] }), finalUrl: `${URL_BASE}/` }),
      '/broken': res({ status: 404, html: '', finalUrl: `${URL_BASE}/broken` }),
    });
    const out = await audit({ url: URL_BASE, paths: ['/', '/broken'], maxPages: 50, fetchImpl });
    const sigs = sigsOf(out.findings);
    const status = out.findings.find((f) => f.signal === 'status' && f.path === '/broken');
    expect(status?.severity).toBe('critical');
    // no content lints on the error page despite it having no title/h1
    expect(sigs).not.toContain('title:/broken');
    expect(sigs).not.toContain('h1:/broken');
    // maillage still resolves the broken inbound link from /
    expect(sigs).toContain('internal-link-broken:/');
  });

  it('appends maillage orphan findings', async () => {
    const fetchImpl = serve({
      '/': res({ html: page({ title: 'H', meta: 'd', h1: 1, links: ['/a'] }), finalUrl: `${URL_BASE}/` }),
      '/a': res({ html: page({ title: 'A', meta: 'd', h1: 1, links: ['/'] }), finalUrl: `${URL_BASE}/a` }),
      '/orphan': res({ html: page({ title: 'O', meta: 'd', h1: 1 }), finalUrl: `${URL_BASE}/orphan` }),
    });
    const out = await audit({ url: URL_BASE, paths: ['/', '/a', '/orphan'], maxPages: 50, fetchImpl });
    const sigs = sigsOf(out.findings);
    expect(sigs).toContain('orphan-page:/orphan');
    expect(sigs).not.toContain('orphan-page:/');
    expect(sigs).not.toContain('orphan-page:/a');
  });

  it('respects ignore globs', async () => {
    const fetchImpl = serve({
      '/noindex': res({ html: page({ title: 'N', meta: 'd', h1: 1, noindex: true }), finalUrl: `${URL_BASE}/noindex` }),
    });
    const out = await audit({ url: URL_BASE, paths: ['/noindex'], maxPages: 50, fetchImpl, ignorePaths: ['/noindex*'] });
    expect(out.findings).toEqual([]);
  });

  it('skips and counts unreachable pages', async () => {
    const fetchImpl = (url: string) =>
      url.endsWith('/robots.txt') ? Promise.resolve(res({ html: '' })) : Promise.resolve(res({ ok: false, status: 0 }));
    const out = await audit({ url: URL_BASE, paths: ['/down'], maxPages: 50, fetchImpl });
    expect(out.skipped).toEqual(['/down']);
    expect(out.pageCount).toBe(0);
  });

  it('defaults sitemap discovery to <url>/sitemap.xml when no paths given', async () => {
    const fetchImpl = (url: string): Promise<FetchResult> => {
      if (url.endsWith('/robots.txt')) return Promise.resolve(res({ html: '' }));
      if (url.endsWith('/sitemap.xml')) {
        return Promise.resolve(res({ html: `<urlset><url><loc>${URL_BASE}/p1</loc></url></urlset>` }));
      }
      if (url.endsWith('/p1')) return Promise.resolve(res({ html: page({ meta: 'd', h1: 1 }), finalUrl: `${URL_BASE}/p1` })); // no title
      return Promise.resolve(res({ status: 404, finalUrl: url }));
    };
    const out = await audit({ url: URL_BASE, maxPages: 50, fetchImpl });
    expect(out.pageCount).toBe(1);
    expect(sigsOf(out.findings)).toContain('title:/p1');
  });
});
