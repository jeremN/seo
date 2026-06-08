import { describe, it, expect } from 'vitest';
import { discover, parseSitemap } from '../src/discover.js';
import type { FetchResult } from '../src/fetcher.js';

const res = (over: Partial<FetchResult>): FetchResult =>
  ({ ok: true, status: 200, headers: {}, html: '', finalUrl: '', ...over });

const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://x.com/a</loc></url>
  <url><loc>https://x.com/b</loc></url>
</urlset>`;

describe('discover', () => {
  it('parseSitemap renvoie les pathnames', () => {
    expect(parseSitemap(SITEMAP)).toEqual(['/a', '/b']);
  });

  it('utilise `paths` en priorité sur le sitemap', async () => {
    const paths = await discover({ paths: ['/x'], maxPages: 50 });
    expect(paths).toEqual(['/x']);
  });

  it('charge le sitemap si pas de paths', async () => {
    const fetchImpl = async () => res({ html: SITEMAP });
    const paths = await discover({ sitemapUrl: 'https://x.com/sitemap.xml', maxPages: 50, fetchImpl });
    expect(paths).toEqual(['/a', '/b']);
  });

  it('applique max-pages et logge le surplus', async () => {
    const logs: string[] = [];
    const fetchImpl = async () => res({ html: SITEMAP });
    const paths = await discover({ sitemapUrl: 'https://x.com/sitemap.xml', maxPages: 1, fetchImpl, log: (m) => logs.push(m) });
    expect(paths).toEqual(['/a']);
    expect(logs[0]).toContain('1 pages ignorées');
  });

  it('lève une erreur si ni paths ni sitemap', async () => {
    await expect(discover({ maxPages: 50 })).rejects.toThrow();
  });
});
