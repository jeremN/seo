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
    expect(out.findings).toMatchObject([{ signal: 'indexability', severity: 'critical' }]);
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
});
