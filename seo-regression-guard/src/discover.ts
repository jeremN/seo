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

// URLs des sous-sitemaps d'un <sitemapindex> (vide si ce n'est pas un index).
export function parseSitemapIndex(xml: string): string[] {
  const doc = new XMLParser().parse(xml);
  const items = doc?.sitemapindex?.sitemap;
  const arr = Array.isArray(items) ? items : items ? [items] : [];
  return arr
    .map((s: { loc?: string }) => String(s.loc ?? ''))
    .filter((u: string) => u.length > 0 && u !== 'undefined');
}

// Résout les pages d'un sitemap : si c'est un <sitemapindex>, suit chaque
// sous-sitemap et agrège ; sinon lit le <urlset> directement.
async function pathsFromSitemap(sitemapUrl: string, fetchImpl: FetchImpl): Promise<string[]> {
  const res = await fetchImpl(sitemapUrl);
  if (!res.ok || res.status >= 400) {
    throw new Error(`Sitemap introuvable: ${sitemapUrl} (status ${res.status})`);
  }
  const children = parseSitemapIndex(res.html);
  if (children.length === 0) return parseSitemap(res.html);
  const all: string[] = [];
  for (const child of children) {
    const cres = await fetchImpl(child);
    if (cres.ok && cres.status < 400) all.push(...parseSitemap(cres.html));
  }
  return all;
}

export async function discover(opts: DiscoverOpts): Promise<string[]> {
  const fetchImpl = opts.fetchImpl ?? fetchUrl;
  const maxPages = Number.isFinite(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 50;

  let paths: string[];
  if (opts.paths && opts.paths.length) {
    paths = opts.paths;
  } else if (opts.sitemapUrl) {
    paths = await pathsFromSitemap(opts.sitemapUrl, fetchImpl);
  } else {
    throw new Error('Config: fournir `paths` ou `sitemap`.');
  }

  if (paths.length === 0) {
    opts.log?.('⚠️ 0 page découverte (sitemap vide, format non reconnu, ou index sans sous-sitemap accessible). Aucune analyse effectuée.');
  }

  if (paths.length > maxPages) {
    opts.log?.(`max-pages=${maxPages} atteint: ${paths.length - maxPages} pages ignorées (sur ${paths.length}).`);
    paths = paths.slice(0, maxPages);
  }
  return paths;
}
