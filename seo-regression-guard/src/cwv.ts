import { mkFinding } from './maillage.js';
import type { Finding } from './types.js';

export type CwvBucket = 'good' | 'needs-improvement' | 'poor';

// Real-user p75 bucket per Google's fixed CWV thresholds: ≤ good is good,
// > poor is poor, anything strictly between is needs-improvement.
export function classify(p75: number, good: number, poor: number): CwvBucket {
  if (p75 <= good) return 'good';
  if (p75 > poor) return 'poor';
  return 'needs-improvement';
}

// CrUX is a POST-with-body API returning JSON — it cannot flow through the
// GET-only FetchImpl, so CWV gets its own narrow injectable (tests inject a fake).
export type CruxFetch = (pageUrl: string, apiKey: string) => Promise<{ status: number; body: unknown }>;

interface MetricDef {
  key: string;            // CrUX metric key
  label: string;          // short display name
  good: number;           // p75 ≤ good ⇒ good
  poor: number;           // p75 > poor ⇒ poor
  fmt: (v: number) => string;
}

// CrUX returns LCP/INP p75 as numbers (ms) and the CLS p75 as a STRING.
const METRICS: MetricDef[] = [
  { key: 'largest_contentful_paint', label: 'LCP', good: 2500, poor: 4000, fmt: (v) => `${Math.round(v)}ms` },
  { key: 'interaction_to_next_paint', label: 'INP', good: 200, poor: 500, fmt: (v) => `${Math.round(v)}ms` },
  { key: 'cumulative_layout_shift', label: 'CLS', good: 0.1, poor: 0.25, fmt: (v) => String(v) },
];

const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

const realCruxFetch: CruxFetch = async (pageUrl, apiKey) => {
  const res = await fetch(`${CRUX_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: pageUrl, metrics: METRICS.map((m) => m.key) }),
  });
  const body: unknown = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

// Defensive narrowing over untrusted CrUX JSON: a missing/odd shape yields null,
// never a throw, so a malformed payload simply produces no finding for that metric.
function getProp(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

function readP75(body: unknown, key: string): number | null {
  const metrics = getProp(getProp(body, 'record'), 'metrics');
  const p75 = getProp(getProp(getProp(metrics, key), 'percentiles'), 'p75');
  if (p75 === undefined || p75 === null) return null;
  const n = typeof p75 === 'string' ? parseFloat(p75) : p75;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// Opt-in, audit-only Core Web Vitals (real-user p75 from CrUX field data).
// One finding per affected metric: poor → warning, needs-improvement → info,
// good → nothing. Never throws: 404 / errors / malformed data ⇒ no findings.
export async function cwvFindings(
  pageUrl: string,
  apiKey: string,
  cruxFetch: CruxFetch = realCruxFetch,
  log?: (msg: string) => void,
): Promise<Finding[]> {
  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await cruxFetch(pageUrl, apiKey));
  } catch (e) {
    log?.(`Core Web Vitals : requête CrUX échouée pour ${pageUrl} (${e instanceof Error ? e.message : String(e)}).`);
    return [];
  }

  if (status === 404) return []; // pas de données terrain pour cette URL — silencieux
  if (status < 200 || status >= 300) {
    log?.(`Core Web Vitals : CrUX a renvoyé ${status} pour ${pageUrl}, métriques ignorées.`);
    return [];
  }

  const path = new URL(pageUrl).pathname;
  const findings: Finding[] = [];
  for (const m of METRICS) {
    const p75 = readP75(body, m.key);
    if (p75 === null) continue;
    const bucket = classify(p75, m.good, m.poor);
    if (bucket === 'good') continue;
    const value = m.fmt(p75);
    const message = bucket === 'poor'
      ? `${m.label} (p75) ${value} — au-dessus du seuil « poor » (${m.fmt(m.poor)}).`
      : `${m.label} (p75) ${value} — à améliorer (bon ≤ ${m.fmt(m.good)}).`;
    findings.push(mkFinding(path, 'core-web-vitals', bucket === 'poor' ? 'warning' : 'info', null, value, message));
  }
  return findings;
}
