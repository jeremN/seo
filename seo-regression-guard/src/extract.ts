import { parse, type HTMLElement } from 'node-html-parser';
import type { SeoSignals } from './types.js';

export function extract(
  html: string,
  status: number,
  headers: Record<string, string>,
  path: string,
  finalUrl: string,
  requestedUrl: string,
): SeoSignals {
  const root = parse(html);
  const metas = root.querySelectorAll('meta');
  const links = root.querySelectorAll('link');

  const metaByName = (name: string): string | null =>
    metas.find((m) => (m.getAttribute('name') ?? '').toLowerCase() === name)?.getAttribute('content') ?? null;

  const metaRobots = (metaByName('robots') ?? '').toLowerCase();
  const xRobots = (headers['x-robots-tag'] ?? '').toLowerCase();
  let noindex = false;
  let source: SeoSignals['robots']['source'] = null;
  if (metaRobots.includes('noindex')) { noindex = true; source = 'meta'; }
  else if (xRobots.includes('noindex')) { noindex = true; source = 'header'; }

  const jsonLd = root
    .querySelectorAll('script')
    .filter((el: HTMLElement) => (el.getAttribute('type') ?? '').toLowerCase() === 'application/ld+json')
    .map((el: HTMLElement) => {
      try {
        const data = JSON.parse(el.text);
        const raw = Array.isArray(data) ? data : [data];
        const types = raw
          .flatMap((d) => (Array.isArray(d?.['@type']) ? d['@type'] : [d?.['@type']]))
          .filter((t): t is string => typeof t === 'string');
        return { valid: true, types };
      } catch {
        return { valid: false, types: [] as string[] };
      }
    });

  const canonical =
    links.find((l) => (l.getAttribute('rel') ?? '').toLowerCase() === 'canonical')?.getAttribute('href') ?? null;

  const origin = (() => { try { return new URL(finalUrl).origin; } catch { return ''; } })();
  const internalLinks = Array.from(new Set(
    root.querySelectorAll('a')
      .map((a) => {
        try {
          const u = new URL(a.getAttribute('href') ?? '', finalUrl);
          return u.origin === origin && (u.protocol === 'http:' || u.protocol === 'https:') ? u.pathname : '';
        } catch { return ''; }
      })
      .filter((p) => p.length > 0),
  ));

  return {
    path,
    reachable: true,
    status,
    redirectedTo: finalUrl !== requestedUrl ? finalUrl : null,
    robots: { noindex, source },
    canonical,
    title: root.querySelector('title')?.text.trim() ?? null,
    metaDescription: metaByName('description')?.trim() ?? null,
    h1: root.querySelectorAll('h1').map((el) => el.text.trim()).filter(Boolean),
    jsonLd,
    internalLinks,
  };
}
