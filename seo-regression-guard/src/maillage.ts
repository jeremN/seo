import { fetchSignals } from './fetchSignals.js';
import type { FetchImpl } from './fetcher.js';
import type { Finding, RobotsRule, SeoSignals, SignalName, Severity } from './types.js';

export function mkFinding(
  path: string, signal: SignalName, severity: Severity,
  before: string | null, after: string | null, message: string,
): Finding {
  return { path, signal, severity, before, after, message };
}

// Maillage interne (preview, absolu) : pages orphelines + liens internes cassés.
// One-hop : les cibles de liens hors du set analysé sont fetchées une fois (bornées).
export async function maillageFindings(
  pagesByPath: Map<string, SeoSignals>,
  baseUrl: string,
  robots: RobotsRule,
  fetchImpl: FetchImpl,
  maxExtraFetches: number,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const pages = [...pagesByPath.values()];

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
    const s = await fetchSignals(baseUrl, t, robots, fetchImpl);
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
