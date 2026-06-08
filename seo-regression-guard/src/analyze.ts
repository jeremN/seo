import { discover } from './discover.js';
import { fetchSignals } from './fetchSignals.js';
import { fetchUrl, type FetchImpl } from './fetcher.js';
import { parseRobots } from './robots.js';
import { diff } from './diff.js';
import type { Finding, RobotsRule } from './types.js';

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
  for (const path of paths) {
    const prod = await fetchSignals(opts.prodUrl, path, prodRobots, fetchImpl);
    const preview = await fetchSignals(opts.previewUrl, path, previewRobots, fetchImpl);
    if (!prod.reachable) { skipped.push(path); opts.log?.(`Prod injoignable, paire sautée: ${path}`); continue; }
    if (!preview.reachable) { skipped.push(path); opts.log?.(`Preview injoignable, paire sautée: ${path}`); continue; }
    for (const finding of diff(prod, preview)) {
      if (!isIgnored(finding.path, ignore)) findings.push(finding);
    }
  }
  return { findings, pageCount: paths.length - skipped.length, skipped };
}
