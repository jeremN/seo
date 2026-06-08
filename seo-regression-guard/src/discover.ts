import { XMLParser } from 'fast-xml-parser';
import { fetchUrl, type FetchImpl } from './fetcher.js';

export interface DiscoverOpts {
  paths?: string[];
  sitemapUrl?: string;
  maxPages: number;
  fetchImpl?: FetchImpl;
  log?: (msg: string) => void;
}

export function parseSitemap(xml: string): string[] {
  const doc = new XMLParser().parse(xml);
  const urls = doc?.urlset?.url;
  const arr = Array.isArray(urls) ? urls : urls ? [urls] : [];
  return arr
    .map((u: { loc?: string }) => {
      try { return new URL(String(u.loc)).pathname; } catch { return ''; }
    })
    .filter((p: string) => p.length > 0);
}

export async function discover(opts: DiscoverOpts): Promise<string[]> {
  let paths: string[];
  if (opts.paths && opts.paths.length) {
    paths = opts.paths;
  } else if (opts.sitemapUrl) {
    const fetchImpl = opts.fetchImpl ?? fetchUrl;
    const res = await fetchImpl(opts.sitemapUrl);
    if (!res.ok || res.status >= 400) {
      throw new Error(`Sitemap introuvable: ${opts.sitemapUrl} (status ${res.status})`);
    }
    paths = parseSitemap(res.html);
  } else {
    throw new Error('Config: fournir `paths` ou `sitemap`.');
  }

  if (paths.length > opts.maxPages) {
    opts.log?.(`max-pages=${opts.maxPages} atteint: ${paths.length - opts.maxPages} pages ignorées (sur ${paths.length}).`);
    paths = paths.slice(0, opts.maxPages);
  }
  return paths;
}
