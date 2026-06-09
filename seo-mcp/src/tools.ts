import { fetchSignals } from "../../seo-regression-guard/lib/fetchSignals.js";
import { parseRobots } from "../../seo-regression-guard/lib/robots.js";
import { fetchUrl, type FetchImpl } from "../../seo-regression-guard/lib/fetcher.js";
import type { RobotsRule, SeoSignals } from "../../seo-regression-guard/lib/types.js";
import { audit } from "../../seo-regression-guard/lib/audit.js";
import { reportJson } from "../../seo-regression-guard/lib/cli-render.js";
import { clampMaxPages } from "./clamp.js";

interface Deps { fetchImpl?: FetchImpl }

async function loadRobots(origin: string, fetchImpl: FetchImpl): Promise<RobotsRule> {
  const r = await fetchImpl(new URL("/robots.txt", origin).toString());
  return r.ok && r.status < 400 ? parseRobots(r.html) : { disallow: [] };
}

export interface AuditArgs {
  url: string;
  paths?: string[];
  sitemap?: string;
  maxPages?: number;
  ignore?: string[];
}

export async function runAudit(args: AuditArgs, deps: Deps = {}) {
  const result = await audit({
    url: args.url,
    paths: args.paths,
    sitemapUrl: args.sitemap,
    maxPages: clampMaxPages(args.maxPages),
    ignorePaths: args.ignore,
    fetchImpl: deps.fetchImpl,
  });
  return reportJson("audit", result);
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
