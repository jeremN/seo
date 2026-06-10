import { discover } from './discover.js';
import { fetchSignals } from './fetchSignals.js';
import { fetchUrl, type FetchImpl } from './fetcher.js';
import { parseRobots } from './robots.js';
import { maillageFindings, mkFinding } from './maillage.js';
import { isIgnored } from './glob.js';
import type { Finding, RobotsRule, SeoSignals } from './types.js';

export interface AuditOpts {
  url: string;
  paths?: string[];
  sitemapUrl?: string;
  maxPages: number;
  ignorePaths?: string[];
  fetchImpl?: FetchImpl;
  log?: (msg: string) => void;
}

export interface AuditResult {
  findings: Finding[];
  pageCount: number;
  skipped: string[];
}

async function loadRobots(baseUrl: string, fetchImpl: FetchImpl): Promise<RobotsRule> {
  const res = await fetchImpl(new URL('/robots.txt', baseUrl).toString());
  return res.ok && res.status < 400 ? parseRobots(res.html) : { disallow: [] };
}

// Lints absolus d'une seule page (par opposition au diff prod↔preview de `analyze`).
// Une page non-2xx (et non-redirigée) ne produit QUE le finding `status` : ses
// title/h1/meta manquants sont des conséquences de l'erreur, pas des régressions.
function pageFindings(p: SeoSignals): Finding[] {
  const is2xx = p.status >= 200 && p.status < 300;
  if (!is2xx && p.redirectedTo === null) {
    return [mkFinding(p.path, 'status', 'critical', null, String(p.status), `Statut HTTP ${p.status} (page en erreur).`)];
  }

  const f: Finding[] = [];
  if (p.robots.noindex) {
    f.push(mkFinding(p.path, 'indexability', 'warning', null, `noindex (${p.robots.source})`, 'Page en noindex.'));
  }
  if (!p.title) {
    f.push(mkFinding(p.path, 'title', 'warning', null, null, 'Title manquant.'));
  }
  if (!p.metaDescription) {
    f.push(mkFinding(p.path, 'meta-description', 'info', null, null, 'Meta description manquante.'));
  }
  if (p.h1.length !== 1) {
    f.push(mkFinding(p.path, 'h1', 'warning', null, `${p.h1.length} H1`, 'Nombre de H1 incorrect (attendu : 1).'));
  }
  if (p.jsonLd.some((j) => !j.valid)) {
    f.push(mkFinding(p.path, 'structured-data', 'warning', null, 'invalide', 'JSON-LD invalide.'));
  }
  if (!p.hasViewport) {
    f.push(mkFinding(p.path, 'viewport', 'warning', null, null, 'Meta viewport manquant (rendu mobile).'));
  }
  if (p.canonicalCount > 1) {
    f.push(mkFinding(p.path, 'canonical-duplicate', 'warning', null, String(p.canonicalCount), `Plusieurs balises canonical (${p.canonicalCount}).`));
  }
  if (!p.hasOpenGraph) {
    f.push(mkFinding(p.path, 'social-tags', 'info', null, null, 'Balises Open Graph absentes (aperçu de partage).'));
  }
  if (!p.hasCharset) {
    f.push(mkFinding(p.path, 'charset', 'info', null, null, 'Déclaration de charset absente.'));
  }
  if (p.title && (p.title.length < 30 || p.title.length > 60)) {
    f.push(mkFinding(p.path, 'title-length', 'info', null, String(p.title.length), `Longueur du title : ${p.title.length} (recommandé 30–60).`));
  }
  if (p.metaDescription && (p.metaDescription.length < 70 || p.metaDescription.length > 160)) {
    f.push(mkFinding(p.path, 'meta-description-length', 'info', null, String(p.metaDescription.length), `Longueur de la meta description : ${p.metaDescription.length} (recommandé 70–160).`));
  }
  return f;
}

export async function audit(opts: AuditOpts): Promise<AuditResult> {
  const fetchImpl = opts.fetchImpl ?? fetchUrl;
  const ignore = opts.ignorePaths ?? [];
  const hasPaths = !!opts.paths?.length;
  const paths = await discover({
    paths: opts.paths,
    sitemapUrl: hasPaths ? undefined : (opts.sitemapUrl ?? new URL('/sitemap.xml', opts.url).toString()),
    maxPages: opts.maxPages,
    fetchImpl,
    log: opts.log,
  });

  const robots = await loadRobots(opts.url, fetchImpl);

  const findings: Finding[] = [];
  const skipped: string[] = [];
  const pagesByPath = new Map<string, SeoSignals>();
  for (const path of paths) {
    const sig = await fetchSignals(opts.url, path, robots, fetchImpl);
    if (!sig.reachable) { skipped.push(path); opts.log?.(`Page injoignable, sautée: ${path}`); continue; }
    pagesByPath.set(path, sig);
    for (const finding of pageFindings(sig)) {
      if (!isIgnored(finding.path, ignore)) findings.push(finding);
    }
  }

  // Maillage interne (orphelines + liens cassés), one-hop borné.
  for (const finding of await maillageFindings(pagesByPath, opts.url, robots, fetchImpl, opts.maxPages)) {
    if (!isIgnored(finding.path, ignore)) findings.push(finding);
  }

  return { findings, pageCount: paths.length - skipped.length, skipped };
}
