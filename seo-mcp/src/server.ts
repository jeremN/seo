import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { runGuard, runAudit, runCheckPage } from "./tools.js";
import { isAllowed } from "./auth.js";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (message: string, hint: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: JSON.stringify({ schema: "seo-guard/v1", kind: "error", message, hint }) }],
});

function authLogin(): string | undefined {
  const auth = getMcpAuthContext();
  return auth?.props?.login as string | undefined;
}

const URL_RE = /^https?:\/\//i;

export function createServer(allowlist: string[], cruxApiKey?: string): McpServer {
  const server = new McpServer({ name: "seo-guard", version: "0.1.0" });

  const guardShape = {
    prodUrl: z.string().url(),
    previewUrl: z.string().url(),
    paths: z.array(z.string()).optional(),
    sitemap: z.string().url().optional(),
    maxPages: z.number().int().positive().optional(),
    failOn: z.enum(["none", "critical", "warning"]).optional(),
    ignore: z.array(z.string()).optional(),
  };
  server.registerTool(
    "guard_pr",
    {
      description: "Diff SEO signals between a production URL and a PR preview URL; returns a seo-guard/v1 report and whether the failure threshold was met. Read-only.",
      inputSchema: guardShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const login = authLogin();
      if (!isAllowed(login, allowlist)) return fail("Forbidden.", "Authenticate with an allowlisted GitHub account.");
      try {
        return json(await runGuard(args));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e), "Check the URLs and network connectivity, then retry.");
      }
    },
  );

  const auditShape = {
    url: z.string().url(),
    paths: z.array(z.string()).optional(),
    sitemap: z.string().url().optional(),
    maxPages: z.number().int().positive().optional(),
    ignore: z.array(z.string()).optional(),
  };
  server.registerTool(
    "audit_site",
    {
      description: "Audit a single live site against absolute SEO best practices (indexability, titles, headings, structured data, orphans/broken links); returns a seo-guard/v1 report. Read-only.",
      inputSchema: auditShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const login = authLogin();
      if (!isAllowed(login, allowlist)) return fail("Forbidden.", "Authenticate with an allowlisted GitHub account.");
      try {
        return json(await runAudit(args, { cruxApiKey }));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e), "Provide --paths or a reachable sitemap, then retry.");
      }
    },
  );

  server.registerTool(
    "check_page",
    {
      description: "Fetch and extract the SEO signals of a single page URL (title, meta, h1s, canonical, robots/noindex, JSON-LD, internal links). Read-only.",
      inputSchema: { url: z.string().regex(URL_RE, "must be an http(s) URL") },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const login = authLogin();
      if (!isAllowed(login, allowlist)) return fail("Forbidden.", "Authenticate with an allowlisted GitHub account.");
      try {
        return json(await runCheckPage(args));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e), "Check that the URL is reachable, then retry.");
      }
    },
  );

  return server;
}
