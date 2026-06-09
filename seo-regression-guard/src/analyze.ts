import { discover } from './discover.js';
import { fetchSignals } from './fetchSignals.js';
import { fetchUrl, type FetchImpl } from './fetcher.js';
import { parseRobots } from './robots.js';
import { diff } from './diff.js';
import { maillageFindings } from './maillage.js';
import { isIgnored } from './glob.js';
import type { Finding, RobotsRule, SeoSignals } from './types.js';

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
  for (const finding of await maillageFindings(previewByPath, opts.previewUrl, previewRobots, fetchImpl, opts.maxPages)) {
    if (!isIgnored(finding.path, ignore)) findings.push(finding);
  }

  return { findings, pageCount: paths.length - skipped.length, skipped };
}
