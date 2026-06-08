import { describe, it, expect } from 'vitest';
import { fetchSignals } from '../src/fetchSignals.js';
import type { FetchResult } from '../src/fetcher.js';

const res = (over: Partial<FetchResult>): FetchResult =>
  ({ ok: true, status: 200, headers: {}, html: '', finalUrl: '', ...over });

describe('fetchSignals', () => {
  it('merge un Disallow robots.txt en noindex source robots.txt', async () => {
    const fetchImpl = async (url: string) =>
      res({ html: '<title>t</title>', finalUrl: url });
    const s = await fetchSignals('https://x.com', '/admin', { disallow: ['/admin'] }, fetchImpl);
    expect(s.robots).toEqual({ noindex: true, source: 'robots.txt' });
  });

  it('marque reachable=false sur échec réseau', async () => {
    const fetchImpl = async () => res({ ok: false, status: 0 });
    const s = await fetchSignals('https://x.com', '/a', { disallow: [] }, fetchImpl);
    expect(s.reachable).toBe(false);
  });

  it('garde status 404 reachable (pour détecter page-removed)', async () => {
    const fetchImpl = async (url: string) => res({ status: 404, html: 'nope', finalUrl: url });
    const s = await fetchSignals('https://x.com', '/gone', { disallow: [] }, fetchImpl);
    expect(s.reachable).toBe(true);
    expect(s.status).toBe(404);
  });
});
