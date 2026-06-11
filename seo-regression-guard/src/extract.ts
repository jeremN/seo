import { parse, type HTMLElement } from 'node-html-parser';
import type { SeoSignals } from './types.js';

// Flatten a parsed JSON-LD payload into its schema.org nodes: a top-level array and any
// `@graph` array are expanded so each node stands alone (a node with `@graph` is replaced by
// its members; arbitrarily-nested `@graph` is recursed). Non-object entries are dropped.
function jsonLdNodes(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (v: unknown): void => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    const obj = v as Record<string, unknown>;
    const graph = obj['@graph'];
    if (Array.isArray(graph)) for (const g of graph) push(g);
    else out.push(obj);
  };
  if (Array.isArray(data)) for (const d of data) push(d);
  else push(data);
  return out;
}

// A node's `@type` value(s), normalised to a string array (schema.org allows a string or array).
function typesOf(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

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
    .flatMap((el: HTMLElement): SeoSignals['jsonLd'] => {
      let data: unknown;
      try {
        data = JSON.parse(el.text);
      } catch {
        return [{ valid: false, types: [], node: null }];
      }
      // One <script> → one-or-more nodes: top-level array and @graph are flattened so each
      // schema.org node is validated independently (Yoast/WordPress emit @graph clusters).
      return jsonLdNodes(data).map((node) => ({ valid: true, types: typesOf(node), node }));
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

  const lower = (v: string | null | undefined): string => (v ?? '').toLowerCase();
  const hasOpenGraph = metas.some((m) => lower(m.getAttribute('property')).startsWith('og:'));
  const hasTwitterCard = metas.some((m) => lower(m.getAttribute('name')).startsWith('twitter:'));
  const hasViewport = metas.some((m) => lower(m.getAttribute('name')) === 'viewport');
  const hasCharset = metas.some(
    (m) => m.getAttribute('charset') != null || lower(m.getAttribute('http-equiv')) === 'content-type',
  );
  const canonicalCount = links.filter((l) => lower(l.getAttribute('rel')) === 'canonical').length;
  const hreflang = links
    .filter((l) => lower(l.getAttribute('rel')) === 'alternate' && l.getAttribute('hreflang') != null)
    .map((l) => ({ lang: l.getAttribute('hreflang') ?? '', href: l.getAttribute('href') ?? '' }));
  const selfPath = (() => { try { return new URL(finalUrl).pathname; } catch { return ''; } })();
  const hreflangHasSelf = hreflang.some((e) => {
    try { const u = new URL(e.href, finalUrl); return u.origin === origin && u.pathname === selfPath; }
    catch { return false; }
  });

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
    hasOpenGraph,
    hasTwitterCard,
    hasViewport,
    hasCharset,
    canonicalCount,
    hreflang,
    hreflangHasSelf,
  };
}
