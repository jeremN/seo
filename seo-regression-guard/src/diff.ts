import type { Finding, SeoSignals, Severity, SignalName } from './types.js';

function mk(
  path: string, signal: SignalName, severity: Severity,
  before: string | null, after: string | null, message: string,
): Finding {
  return { path, signal, severity, before, after, message };
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

// Compare redirects by path (+ query), not absolute URL: prod and preview live on
// different hosts by design, so a same-site redirect (e.g. CF Pages' .html → clean URL)
// would otherwise look like a "changed target".
function redirectPath(url: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

export function diff(prod: SeoSignals, preview: SeoSignals): Finding[] {
  const path = preview.path;
  if (!prod.reachable || !preview.reachable) return []; // pas de known-good / preview down

  const prodMissing = prod.status === 404;
  const previewMissing = preview.status === 404;

  if (prodMissing && !previewMissing) {
    return [mk(path, 'new-page', 'info', null, String(preview.status), 'Nouvelle page (absente de la prod).')];
  }
  if (!prodMissing && previewMissing) {
    return [mk(path, 'page-removed', 'critical', String(prod.status), '404', 'Page indexée supprimée (404 en preview).')];
  }

  const f: Finding[] = [];

  // status / redirect (seulement si la prod était servie en 2xx). Redirections
  // comparées par path (host-indépendant) via redirectPath().
  if (prod.status >= 200 && prod.status < 300) {
    const prodRedir = redirectPath(prod.redirectedTo);
    const previewRedir = redirectPath(preview.redirectedTo);
    if (preview.status >= 500) {
      f.push(mk(path, 'status', 'critical', String(prod.status), String(preview.status), 'Erreur serveur en preview.'));
    } else if (previewRedir && !prodRedir) {
      f.push(mk(path, 'status', 'critical', '200', `→ ${previewRedir}`, 'La page redirige désormais.'));
    } else if (previewRedir && prodRedir && previewRedir !== prodRedir) {
      f.push(mk(path, 'status', 'critical', `→ ${prodRedir}`, `→ ${previewRedir}`, 'Cible de redirection changée.'));
    }
  }

  // indexability — on ignore le noindex d'origine `header` (X-Robots-Tag) : les
  // hébergeurs de preview (Cloudflare Pages, Vercel, Netlify…) l'injectent sur TOUTES
  // les previews pour les garder hors de Google. Seul le noindex `meta`/`robots.txt`
  // (contrôlé par le code de la PR) est une vraie régression.
  if (preview.robots.noindex && preview.robots.source !== 'header' && !prod.robots.noindex) {
    f.push(mk(path, 'indexability', 'critical', 'indexable', `noindex (${preview.robots.source})`, 'noindex nouvellement introduit.'));
  }

  // canonical
  if (prod.canonical && !preview.canonical) {
    f.push(mk(path, 'canonical', 'critical', prod.canonical, null, 'Canonical supprimé.'));
  } else if (prod.canonical && preview.canonical && preview.canonical !== prod.canonical) {
    const offDomain = hostOf(preview.canonical) !== hostOf(prod.canonical);
    f.push(mk(path, 'canonical', offDomain ? 'critical' : 'warning', prod.canonical, preview.canonical,
      offDomain ? 'Canonical pointe hors-domaine.' : 'Canonical modifié (autre path on-site).'));
  }

  // title
  if (prod.title && !preview.title) {
    f.push(mk(path, 'title', 'warning', prod.title, null, 'Title supprimé.'));
  } else if (prod.title && preview.title && prod.title !== preview.title) {
    f.push(mk(path, 'title', 'info', prod.title, preview.title, 'Title modifié.'));
  }

  // meta description
  if (prod.metaDescription && !preview.metaDescription) {
    f.push(mk(path, 'meta-description', 'warning', prod.metaDescription, null, 'Meta description supprimée.'));
  }

  // h1
  if (prod.h1.length === 1 && preview.h1.length === 0) {
    f.push(mk(path, 'h1', 'warning', prod.h1[0], null, 'H1 supprimé.'));
  } else if (prod.h1.length === 1 && preview.h1.length > 1) {
    f.push(mk(path, 'h1', 'warning', '1 H1', `${preview.h1.length} H1`, 'Plusieurs H1 introduits.'));
  }

  // structured data
  const prodHadValid = prod.jsonLd.some((j) => j.valid);
  const previewHasValid = preview.jsonLd.some((j) => j.valid);
  const prodHadInvalid = prod.jsonLd.some((j) => !j.valid);
  const previewHasInvalid = preview.jsonLd.some((j) => !j.valid);
  if (prodHadValid && !previewHasValid) {
    f.push(mk(path, 'structured-data', 'warning', 'JSON-LD présent', 'absent', 'Données structurées supprimées.'));
  } else if (previewHasInvalid && !prodHadInvalid) {
    f.push(mk(path, 'structured-data', 'warning', 'JSON-LD valide', 'invalide', 'JSON-LD désormais invalide.'));
  }

  // social tags (Open Graph) retirées — casse les aperçus de partage
  if (prod.hasOpenGraph && !preview.hasOpenGraph) {
    f.push(mk(path, 'social-tags', 'warning', 'Open Graph', 'absent', 'Balises Open Graph supprimées.'));
  }

  // viewport retiré — casse le rendu mobile
  if (prod.hasViewport && !preview.hasViewport) {
    f.push(mk(path, 'viewport', 'warning', 'viewport', 'absent', 'Meta viewport supprimé.'));
  }

  // canonical multiples nouvellement introduits (canonicals en conflit)
  if (preview.canonicalCount > 1 && prod.canonicalCount <= 1) {
    f.push(mk(path, 'canonical-duplicate', 'warning', String(prod.canonicalCount), String(preview.canonicalCount), 'Balises canonical multiples introduites.'));
  }

  return f;
}
