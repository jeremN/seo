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

  it('suit un sitemap index et agrège les sous-sitemaps', async () => {
    const INDEX = `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://x.com/sitemap-pages.xml</loc></sitemap>
    </sitemapindex>`;
    const fetchImpl = async (url: string) =>
      url.includes('sitemap-pages.xml') ? res({ html: SITEMAP }) : res({ html: INDEX });
    const paths = await discover({ sitemapUrl: 'https://x.com/sitemap.xml', maxPages: 50, fetchImpl });
    expect(paths).toEqual(['/a', '/b']);
  });

  it('logge un warning quand 0 page découverte', async () => {
    const logs: string[] = [];
    const fetchImpl = async () => res({ html: '<?xml version="1.0"?><urlset></urlset>' });
    const paths = await discover({ sitemapUrl: 'https://x.com/sitemap.xml', maxPages: 50, fetchImpl, log: (m) => logs.push(m) });
    expect(paths).toEqual([]);
    expect(logs.some((l) => l.includes('0 page'))).toBe(true);
  });

  it('cape à 50 par défaut quand max-pages est non numérique', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `/p${i}`);
    const paths = await discover({ paths: many, maxPages: NaN });
    expect(paths).toHaveLength(50);
  });
});
