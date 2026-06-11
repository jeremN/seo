export type Severity = 'critical' | 'warning' | 'info';

export type SignalName =
  | 'indexability' | 'canonical' | 'status' | 'page-removed'
  | 'title' | 'meta-description' | 'h1' | 'structured-data' | 'new-page'
  | 'orphan-page' | 'internal-link-broken'
  | 'social-tags' | 'viewport' | 'charset' | 'title-length'
  | 'meta-description-length' | 'canonical-duplicate' | 'hreflang'
  | 'core-web-vitals';

export interface RobotsRule {
  disallow: string[];
}

export interface SeoSignals {
  path: string;
  reachable: boolean;            // false → échec réseau ; une paire non-reachable est sautée
  status: number;
  redirectedTo: string | null;   // finalUrl si une redirection a eu lieu
  robots: { noindex: boolean; source: 'meta' | 'header' | 'robots.txt' | null };
  canonical: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  jsonLd: { valid: boolean; types: string[] }[];
  internalLinks: string[];       // pathnames des liens <a> same-origin (pour le maillage)
  hasOpenGraph: boolean;         // au moins une balise <meta property="og:*">
  hasTwitterCard: boolean;       // au moins une balise <meta name="twitter:*">
  hasViewport: boolean;          // <meta name="viewport"> présent
  hasCharset: boolean;           // <meta charset> ou http-equiv Content-Type présent
  canonicalCount: number;        // nombre de <link rel="canonical"> (>1 = conflit)
  hreflang: { lang: string; href: string }[]; // annotations <link rel=alternate hreflang>
  hreflangHasSelf: boolean;      // une annotation hreflang pointe vers cette page
}

export interface Finding {
  path: string;
  signal: SignalName;
  severity: Severity;
  before: string | null;
  after: string | null;
  message: string;
}
