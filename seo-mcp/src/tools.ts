import { fetchSignals } from "../../seo-regression-guard/lib/fetchSignals.js";
import { parseRobots } from "../../seo-regression-guard/lib/robots.js";
import { fetchUrl, type FetchImpl } from "../../seo-regression-guard/lib/fetcher.js";
import type { RobotsRule, SeoSignals } from "../../seo-regression-guard/lib/types.js";
import { audit } from "../../seo-regression-guard/lib/audit.js";
import { analyze } from "../../seo-regression-guard/lib/analyze.js";
import { reportJson, meetsThreshold } from "../../seo-regression-guard/lib/cli-render.js";
import type { FailOn } from "../../seo-regression-guard/lib/report.js";
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

export interface GuardArgs {
  prodUrl: string;
  previewUrl: string;
  paths?: string[];
  sitemap?: string;
  maxPages?: number;
  failOn?: FailOn;
  ignore?: string[];
}

export async function runGuard(args: GuardArgs, deps: Deps = {}) {
  const failOn: FailOn = args.failOn ?? "critical";
  const paths = args.paths;
  const result = await analyze({
    prodUrl: args.prodUrl,
    previewUrl: args.previewUrl,
    paths,
    sitemapUrl: paths?.length ? undefined : (args.sitemap ?? new URL("/sitemap.xml", args.previewUrl).toString()),
    maxPages: clampMaxPages(args.maxPages),
    ignorePaths: args.ignore,
    fetchImpl: deps.fetchImpl,
  });
  return { report: reportJson("guard", result), thresholdMet: meetsThreshold(result.findings, failOn) };
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
