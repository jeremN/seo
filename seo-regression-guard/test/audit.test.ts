import { describe, it, expect } from 'vitest';
import { audit } from '../src/audit.js';
import type { FetchResult } from '../src/fetcher.js';

const res = (over: Partial<FetchResult>): FetchResult =>
  ({ ok: true, status: 200, headers: {}, html: '', finalUrl: '', ...over });

// Healthy-by-default head/meta lengths (inside the recommended windows).
const OK_TITLE = 'A reasonable page title within the limit'; // 40 chars (30–60)
const OK_META =
  'A reasonable meta description that comfortably sits within the recommended length window for search snippets.'; // ~108 chars (70–160)

// HTML page builder. Defaults to a fully-healthy page so the absolute lints stay
// quiet unless a test deliberately breaks one axis:
//   title/meta: undefined → healthy default; a string → used verbatim; false → omitted.
//   h1 default 1; viewport/og/charset default present; canonical default 1.
function page(opts: {
  title?: string | false;
  meta?: string | false;
  h1?: number;
  noindex?: boolean;
  jsonld?: 'valid' | 'invalid';
  viewport?: boolean;
  og?: boolean;
  charset?: boolean;
  canonical?: number;
  links?: string[];
} = {}): string {
  const parts: string[] = [];
  if (opts.charset !== false) parts.push('<meta charset="utf-8">');
  if (opts.viewport !== false) parts.push('<meta name="viewport" content="width=device-width">');
  if (opts.og !== false) parts.push('<meta property="og:title" content="x">');
  if (opts.noindex) parts.push('<meta name="robots" content="noindex">');

  const title = opts.title === undefined ? OK_TITLE : opts.title;
  if (title !== false) parts.push(`<title>${title}</title>`);
  const meta = opts.meta === undefined ? OK_META : opts.meta;
  if (meta !== false) parts.push(`<meta name="description" content="${meta}">`);

  for (let i = 0; i < (opts.h1 ?? 1); i++) parts.push(`<h1>h${i}</h1>`);
  for (let i = 0; i < (opts.canonical ?? 1); i++) parts.push(`<link rel="canonical" href="https://site.example/c${i}">`);

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

// Audit a single page built from `page(opts)` and return its `signal:path` list,
// minus the orphan-page finding a lone non-root page always gets (it has no inbound
// links) — that's maillage noise, irrelevant to the per-page lint under test.
async function auditOne(opts: Parameters<typeof page>[0]): Promise<string[]> {
  const fetchImpl = serve({ '/p': res({ html: page(opts), finalUrl: `${URL_BASE}/p` }) });
  const out = await audit({ url: URL_BASE, paths: ['/p'], maxPages: 50, fetchImpl });
  return sigsOf(out.findings).filter((s) => !s.startsWith('orphan-page'));
}

describe('audit', () => {
  it('flags absolute per-page issues (noindex, missing title/meta, bad h1, invalid json-ld)', async () => {
    const fetchImpl = serve({
      '/': res({ html: page({ jsonld: 'valid', links: ['/nometa', '/noindex', '/noh1', '/multih1', '/badld', '/notitle'] }), finalUrl: `${URL_BASE}/` }),
      '/nometa': res({ html: page({ meta: false, links: ['/'] }), finalUrl: `${URL_BASE}/nometa` }),
      '/noindex': res({ html: page({ noindex: true, links: ['/'] }), finalUrl: `${URL_BASE}/noindex` }),
      '/noh1': res({ html: page({ h1: 0, links: ['/'] }), finalUrl: `${URL_BASE}/noh1` }),
      '/multih1': res({ html: page({ h1: 2, links: ['/'] }), finalUrl: `${URL_BASE}/multih1` }),
      '/badld': res({ html: page({ jsonld: 'invalid', links: ['/'] }), finalUrl: `${URL_BASE}/badld` }),
      '/notitle': res({ html: page({ title: false, links: ['/'] }), finalUrl: `${URL_BASE}/notitle` }),
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
    // a fully-healthy page (/) produces no finding at all
    expect(sigs.filter((s) => s.endsWith(':/'))).toEqual([]);
    expect(out.pageCount).toBe(7);
  });

  it('audit flags noindex as a warning (not critical like guard)', async () => {
    const out = await audit({
      url: URL_BASE, paths: ['/'], maxPages: 50,
      fetchImpl: serve({ '/': res({ html: page({ noindex: true }), finalUrl: `${URL_BASE}/` }) }),
    });
    expect(out.findings.find((f) => f.signal === 'indexability')?.severity).toBe('warning');
  });

  it('flags non-2xx pages as critical status and skips content lints on them', async () => {
    const fetchImpl = serve({
      '/': res({ html: page({ links: ['/broken'] }), finalUrl: `${URL_BASE}/` }),
      '/broken': res({ status: 404, html: '', finalUrl: `${URL_BASE}/broken` }),
    });
    const out = await audit({ url: URL_BASE, paths: ['/', '/broken'], maxPages: 50, fetchImpl });
    const sigs = sigsOf(out.findings);
    expect(out.findings.find((f) => f.signal === 'status' && f.path === '/broken')?.severity).toBe('critical');
    // no content lints on the error page — including the new head/meta ones
    expect(sigs.filter((s) => s.endsWith(':/broken'))).toEqual(['status:/broken']);
    // maillage still resolves the broken inbound link from /
    expect(sigs).toContain('internal-link-broken:/');
  });

  it('appends maillage orphan findings', async () => {
    const fetchImpl = serve({
      '/': res({ html: page({ links: ['/a'] }), finalUrl: `${URL_BASE}/` }),
      '/a': res({ html: page({ links: ['/'] }), finalUrl: `${URL_BASE}/a` }),
      '/orphan': res({ html: page({}), finalUrl: `${URL_BASE}/orphan` }),
    });
    const out = await audit({ url: URL_BASE, paths: ['/', '/a', '/orphan'], maxPages: 50, fetchImpl });
    const sigs = sigsOf(out.findings);
    expect(sigs).toContain('orphan-page:/orphan');
    expect(sigs).not.toContain('orphan-page:/');
    expect(sigs).not.toContain('orphan-page:/a');
  });

  it('respects ignore globs', async () => {
    const fetchImpl = serve({ '/noindex': res({ html: page({ noindex: true }), finalUrl: `${URL_BASE}/noindex` }) });
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
      if (url.endsWith('/p1')) return Promise.resolve(res({ html: page({ title: false }), finalUrl: `${URL_BASE}/p1` }));
      return Promise.resolve(res({ status: 404, finalUrl: url }));
    };
    const out = await audit({ url: URL_BASE, maxPages: 50, fetchImpl });
    expect(out.pageCount).toBe(1);
    expect(sigsOf(out.findings)).toContain('title:/p1');
  });

  // --- head/meta hygiene (new absolute signals) ---

  it('flags missing viewport (warning), missing OG (info), missing charset (info)', async () => {
    expect(await auditOne({ viewport: false })).toContain('viewport:/p');
    expect(await auditOne({ og: false })).toContain('social-tags:/p');
    expect(await auditOne({ charset: false })).toContain('charset:/p');
    // a fully-healthy page triggers none of them
    expect(await auditOne({})).toEqual([]);
  });

  it('viewport missing is a warning; OG/charset are info', async () => {
    const sev = async (opts: Parameters<typeof page>[0], signal: string) => {
      const fetchImpl = serve({ '/p': res({ html: page(opts), finalUrl: `${URL_BASE}/p` }) });
      const out = await audit({ url: URL_BASE, paths: ['/p'], maxPages: 50, fetchImpl });
      return out.findings.find((f) => f.signal === signal)?.severity;
    };
    expect(await sev({ viewport: false }, 'viewport')).toBe('warning');
    expect(await sev({ og: false }, 'social-tags')).toBe('info');
    expect(await sev({ charset: false }, 'charset')).toBe('info');
  });

  it('flags duplicate canonical as a warning', async () => {
    const fetchImpl = serve({ '/p': res({ html: page({ canonical: 2 }), finalUrl: `${URL_BASE}/p` }) });
    const out = await audit({ url: URL_BASE, paths: ['/p'], maxPages: 50, fetchImpl });
    expect(out.findings.find((f) => f.signal === 'canonical-duplicate')?.severity).toBe('warning');
  });

  it('flags title length only outside 30–60 (boundaries inclusive-ok)', async () => {
    expect(await auditOne({ title: 'x'.repeat(29) })).toContain('title-length:/p');
    expect(await auditOne({ title: 'x'.repeat(30) })).not.toContain('title-length:/p');
    expect(await auditOne({ title: 'x'.repeat(60) })).not.toContain('title-length:/p');
    expect(await auditOne({ title: 'x'.repeat(61) })).toContain('title-length:/p');
  });

  it('flags meta description length only outside 70–160 (boundaries inclusive-ok)', async () => {
    expect(await auditOne({ meta: 'x'.repeat(69) })).toContain('meta-description-length:/p');
    expect(await auditOne({ meta: 'x'.repeat(70) })).not.toContain('meta-description-length:/p');
    expect(await auditOne({ meta: 'x'.repeat(160) })).not.toContain('meta-description-length:/p');
    expect(await auditOne({ meta: 'x'.repeat(161) })).toContain('meta-description-length:/p');
  });
});
