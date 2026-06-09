import { fetchSignals } from "../../seo-regression-guard/lib/fetchSignals.js";
import { parseRobots } from "../../seo-regression-guard/lib/robots.js";
import { fetchUrl, type FetchImpl } from "../../seo-regression-guard/lib/fetcher.js";
import type { RobotsRule, SeoSignals } from "../../seo-regression-guard/lib/types.js";

interface Deps { fetchImpl?: FetchImpl }

async function loadRobots(origin: string, fetchImpl: FetchImpl): Promise<RobotsRule> {
  const r = await fetchImpl(new URL("/robots.txt", origin).toString());
  return r.ok && r.status < 400 ? parseRobots(r.html) : { disallow: [] };
}

export async function runCheckPage(
  args: { url: string },
  deps: Deps = {},
): Promise<SeoSignals> {
  const fetchImpl = deps.fetchImpl ?? fetchUrl;
  const u = new URL(args.url);
  const robots = await loadRobots(u.origin, fetchImpl);
  return fetchSignals(u.origin, u.pathname, robots, fetchImpl);
}
