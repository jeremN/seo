import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import type { FetchResult } from '../src/fetcher.js';

const res = (over: Partial<FetchResult>): FetchResult =>
  ({ ok: true, status: 200, headers: {}, html: '', finalUrl: '', ...over });

// prod /a indexable ; preview /a noindex → 1 critical
function router(url: string): Promise<FetchResult> {
  if (url.endsWith('/robots.txt')) return Promise.resolve(res({ html: '' }));
  if (url.includes('preview') && url.endsWith('/a')) return Promise.resolve(res({ html: '<meta name="robots" content="noindex"><title>t</title>', finalUrl: url }));
  return Promise.resolve(res({ html: '<title>t</title>', finalUrl: url }));
}

describe('analyze', () => {
  it('produit les findings sur la paire et compte les pages', async () => {
    const out = await analyze({
      prodUrl: 'https://prod.x.com', previewUrl: 'https://preview.x.com',
      paths: ['/a'], maxPages: 50, fetchImpl: router,
    });
    expect(out.pageCount).toBe(1);
    expect(out.findings).toContainEqual(
      expect.objectContaining({ signal: 'indexability', severity: 'critical' }),
    );
  });

  it('ignore-paths neutralise les findings matchés', async () => {
    const out = await analyze({
      prodUrl: 'https://prod.x.com', previewUrl: 'https://preview.x.com',
      paths: ['/a'], maxPages: 50, fetchImpl: router, ignorePaths: ['/a*'],
    });
    expect(out.findings).toEqual([]);
  });

  it('saute et compte les paires non-reachable', async () => {
    const down = (url: string) =>
      url.endsWith('/robots.txt') ? Promise.resolve(res({ html: '' })) : Promise.resolve(res({ ok: false, status: 0 }));
    const out = await analyze({
      prodUrl: 'https://prod.x.com', previewUrl: 'https://preview.x.com',
      paths: ['/a'], maxPages: 50, fetchImpl: down,
    });
    expect(out.skipped).toEqual(['/a']);
    expect(out.pageCount).toBe(0);
  });

  it('détecte orphelines et liens internes cassés (maillage)', async () => {
    const pages: Record<string, string> = {
      '/': '<a href="/a">a</a><a href="/b">b</a>',
      '/a': '<a href="/">home</a>',
      '/b': '<a href="/missing">x</a>',
      '/orphan': '<p>nobody links here</p>',
    };
    const fetchImpl = async (url: string): Promise<FetchResult> => {
      if (url.endsWith('/robots.txt')) return res({ html: '' });
      const p = new URL(url).pathname;
      if (p === '/missing') return res({ status: 404, finalUrl: url });
      return res({ html: `<title>t</title>${pages[p] ?? ''}`, finalUrl: url });
    };
    const out = await analyze({
      prodUrl: 'https://prod.x', previewUrl: 'https://preview.x',
      paths: ['/', '/a', '/b', '/orphan'], maxPages: 50, fetchImpl,
    });
    const sigs = out.findings.map((f) => `${f.signal}:${f.path}`);
    expect(sigs).toContain('orphan-page:/orphan');
    expect(sigs).toContain('internal-link-broken:/b');
    expect(sigs).not.toContain('orphan-page:/');
    expect(sigs).not.toContain('orphan-page:/a');
  });
});
