export type Severity = 'critical' | 'warning' | 'info';

export type SignalName =
  | 'indexability' | 'canonical' | 'status' | 'page-removed'
  | 'title' | 'meta-description' | 'h1' | 'structured-data' | 'new-page';

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
}

export interface Finding {
  path: string;
  signal: SignalName;
  severity: Severity;
  before: string | null;
  after: string | null;
  message: string;
}
