import { describe, it, expect } from "vitest";
import { runCheckPage } from "../src/tools.js";
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
