import { fetchUrl, type FetchImpl } from './fetcher.js';
import { extract } from './extract.js';
import { isDisallowed } from './robots.js';
import type { RobotsRule, SeoSignals } from './types.js';

export async function fetchSignals(
  baseUrl: string,
  path: string,
  robots: RobotsRule,
  fetchImpl: FetchImpl = fetchUrl,
): Promise<SeoSignals> {
  const requestedUrl = new URL(path, baseUrl).toString();
  const res = await fetchImpl(requestedUrl);
  if (!res.ok) return unreachable(path);

  const signals = extract(res.html, res.status, res.headers, path, res.finalUrl, requestedUrl);
  if (!signals.robots.noindex && isDisallowed(robots, path)) {
    signals.robots = { noindex: true, source: 'robots.txt' };
  }
  return signals;
}

function unreachable(path: string): SeoSignals {
  return {
    path, reachable: false, status: 0, redirectedTo: null,
    robots: { noindex: false, source: null }, canonical: null,
    title: null, metaDescription: null, h1: [], jsonLd: [],
  };
}
