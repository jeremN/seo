import { discover } from './discover.js';
import { fetchSignals } from './fetchSignals.js';
import { fetchUrl, type FetchImpl } from './fetcher.js';
import { parseRobots } from './robots.js';
import { diff } from './diff.js';
import type { Finding, RobotsRule, SeoSignals, SignalName, Severity } from './types.js';

export interface AnalyzeOpts {
  prodUrl: string;
  previewUrl: string;
  paths?: string[];
  sitemapUrl?: string;
  maxPages: number;
  ignorePaths?: string[];
  fetchImpl?: FetchImpl;
  log?: (msg: string) => void;
}

export interface AnalyzeResult {
  findings: Finding[];
  pageCount: number;
  skipped: string[];
}

/**
 * Linear glob matcher — supports only `*` as a wildcard (matches any sequence
 * of characters). Uses no RegExp so it is immune to ReDoS.
 */
function matchGlob(glob: string, str: string): boolean {
  const parts = glob.split('*');
  if (parts.length === 1) return glob === str;
  if (!str.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (i === parts.length - 1) {
      // Last segment must match the tail of str exactly.
      return str.endsWith(seg) && pos <= str.length - seg.length;
    }
    const idx = str.indexOf(seg, pos);
    if (idx === -1) return false;
    pos = idx + seg.length;
  }
  return true;
}

function isIgnored(path: string, globs: string[]): boolean {
  return globs.some((g) => matchGlob(g, path));
}

async function loadRobots(baseUrl: string, fetchImpl: FetchImpl): Promise<RobotsRule> {
  const res = await fetchImpl(new URL('/robots.txt', baseUrl).toString());
  return res.ok && res.status < 400 ? parseRobots(res.html) : { disallow: [] };
}

export async function analyze(opts: AnalyzeOpts): Promise<AnalyzeResult> {
  const fetchImpl = opts.fetchImpl ?? fetchUrl;
  const ignore = opts.ignorePaths ?? [];
  const paths = await discover({
    paths: opts.paths, sitemapUrl: opts.sitemapUrl, maxPages: opts.maxPages, fetchImpl, log: opts.log,
  });

  const [prodRobots, previewRobots] = await Promise.all([
    loadRobots(opts.prodUrl, fetchImpl),
    loadRobots(opts.previewUrl, fetchImpl),
  ]);

  const findings: Finding[] = [];
  const skipped: string[] = [];
  const previewByPath = new Map<string, SeoSignals>();
  for (const path of paths) {
    const prod = await fetchSignals(opts.prodUrl, path, prodRobots, fetchImpl);
    const preview = await fetchSignals(opts.previewUrl, path, previewRobots, fetchImpl);
    if (!prod.reachable) { skipped.push(path); opts.log?.(`Prod injoignable, paire sautée: ${path}`); continue; }
    if (!preview.reachable) { skipped.push(path); opts.log?.(`Preview injoignable, paire sautée: ${path}`); continue; }
    previewByPath.set(path, preview);
    for (const finding of diff(prod, preview)) {
      if (!isIgnored(finding.path, ignore)) findings.push(finding);
    }
  }

  // Maillage interne (cross-page, calculé sur la preview)
  for (const finding of await analyzeMaillage(previewByPath, opts.previewUrl, previewRobots, fetchImpl, opts.maxPages)) {
    if (!isIgnored(finding.path, ignore)) findings.push(finding);
  }

  return { findings, pageCount: paths.length - skipped.length, skipped };
}

function mkFinding(
  path: string, signal: SignalName, severity: Severity,
  before: string | null, after: string | null, message: string,
): Finding {
  return { path, signal, severity, before, after, message };
}

// Maillage interne (preview, absolu) : pages orphelines + liens internes cassés.
// One-hop : les cibles de liens hors du set analysé sont fetchées une fois (bornées).
async function analyzeMaillage(
  previewByPath: Map<string, SeoSignals>,
  previewUrl: string,
  robots: RobotsRule,
  fetchImpl: FetchImpl,
  maxExtraFetches: number,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const pages = [...previewByPath.values()];

  // Liens internes entrants (pour les orphelines)
  const inbound = new Map<string, number>();
  for (const p of pages) {
    for (const target of p.internalLinks) {
      if (target !== p.path) inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }

  // Orphelines : page analysée 2xx, hors racine, sans aucun lien interne entrant
  for (const p of pages) {
    if (p.status >= 200 && p.status < 300 && p.path !== '/' && (inbound.get(p.path) ?? 0) === 0) {
      findings.push(mkFinding(p.path, 'orphan-page', 'warning', null, 'aucun lien interne entrant', 'Page orpheline (liée par aucune autre page).'));
    }
  }

  // Statut connu des pages du set ; one-hop borné pour les cibles inconnues
  const status = new Map<string, number>();
  for (const p of pages) status.set(p.path, p.status);
  const unknown = [...new Set(pages.flatMap((p) => p.internalLinks).filter((t) => !status.has(t)))];
  let budget = Math.max(0, maxExtraFetches);
  for (const t of unknown) {
    if (budget-- <= 0) break;
    const s = await fetchSignals(previewUrl, t, robots, fetchImpl);
    status.set(t, s.reachable ? s.status : 0);
  }

  // Liens internes cassés : page → cible qui renvoie 404
  const seen = new Set<string>();
  for (const p of pages) {
    for (const t of p.internalLinks) {
      if (status.get(t) === 404) {
        const key = `${p.path}→${t}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(mkFinding(p.path, 'internal-link-broken', 'warning', t, '404', `Lien interne cassé vers ${t}.`));
        }
      }
    }
  }
  return findings;
}
