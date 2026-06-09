import { describe, it, expect } from "vitest";
import { runCheckPage, runAudit } from "../src/tools.js";
import type { FetchResult } from "../../seo-regression-guard/lib/fetcher.js";

const res = (over: Partial<FetchResult>): FetchResult =>
  ({ ok: true, status: 200, headers: {}, html: "", finalUrl: "", ...over });

describe("runCheckPage", () => {
  it("returns the SeoSignals for a single URL", async () => {
    const fetchImpl = (url: string) => {
      if (url.endsWith("/robots.txt")) return Promise.resolve(res({ html: "" }));
      return Promise.resolve(res({
        html: '<title>Hi</title><meta name="robots" content="noindex">',
        finalUrl: "https://x.com/pricing",
      }));
    };
    const out = await runCheckPage({ url: "https://x.com/pricing" }, { fetchImpl });
    expect(out.path).toBe("/pricing");
    expect(out.title).toBe("Hi");
    expect(out.robots.noindex).toBe(true);
  });
});

describe("runAudit", () => {
  it("returns a seo-guard/v1 report for a single site", async () => {
    const fetchImpl = (url: string) => {
      if (url.endsWith("/robots.txt")) return Promise.resolve(res({ html: "" }));
      const p = new URL(url).pathname;
      if (p === "/") return Promise.resolve(res({
        html: '<title>H</title><meta name="description" content="d"><h1>h</h1>',
        finalUrl: url,
      }));
      return Promise.resolve(res({ html: "<h1>h</h1>", finalUrl: url })); // no title
    };
    const out = await runAudit({ url: "https://x.com", paths: ["/", "/x"] }, { fetchImpl });
    expect(out.schema).toBe("seo-guard/v1");
    expect(out.kind).toBe("report");
    expect(out.command).toBe("audit");
    expect(out.findings.some((f) => f.signal === "title" && f.path === "/x")).toBe(true);
  });
});
