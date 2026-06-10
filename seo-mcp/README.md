# seo-guard MCP server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the SEO core (the same engine behind the GitHub Action and the `seo-guard` CLI) as three
read-only tools, so Claude (Desktop / web / Code) can run SEO checks on demand.

Runs **stateless** on Cloudflare Workers (free tier), fronted by **OAuth 2.1 with GitHub**
identity and gated to an allowlist of GitHub logins.

## Tools

All three are read-only (`readOnlyHint: true`) and return the versioned `seo-guard/v1`
JSON contract (see [`../seo-regression-guard/schema/seo-guard.v1.json`](../seo-regression-guard/schema/seo-guard.v1.json)).

| Tool | Input | Returns |
|---|---|---|
| `guard_pr` | `{ prodUrl, previewUrl, paths?, sitemap?, maxPages?, failOn?, ignore? }` | `{ report, thresholdMet }` — prod↔preview diff |
| `audit_site` | `{ url, paths?, sitemap?, maxPages?, ignore? }` | a `seo-guard/v1` report — absolute single-site audit |
| `check_page` | `{ url }` | the raw `SeoSignals` for one page |

`maxPages` is bounded (default 50, hard cap 200).

## Architecture

- **Stateless** MCP via `createMcpHandler` (`agents` SDK) — a plain Worker, no Durable
  Objects. A fresh `McpServer` is built per request (MCP SDK ≥ 1.26 isolation requirement).
- **`@cloudflare/workers-oauth-provider`** is the OAuth 2.1 server; `src/github-handler.ts`
  authenticates the human via GitHub and mints a bound MCP token whose `props.login` the
  tools read (`getMcpAuthContext()`) to enforce the allowlist.
- Tools call the pure core, consumed as plain JS emitted to `../seo-regression-guard/lib/`
  by `build:lib` (run automatically before `dev`/`deploy`/`test`).

## One-time setup

1. **Create a GitHub OAuth App** at <https://github.com/settings/developers> → *New OAuth App*:
   - **Homepage URL:** `https://seo-mcp.<your-subdomain>.workers.dev`
   - **Authorization callback URL:** `https://seo-mcp.<your-subdomain>.workers.dev/callback`

   Note the **Client ID** and generate a **Client Secret**.

2. **Create the KV namespace** (stores OAuth/grant state) and put its id in `wrangler.jsonc`
   (replace `PLACEHOLDER_SET_IN_TASK_6`):
   ```bash
   npx wrangler kv namespace create OAUTH_KV
   ```

3. **Set the secrets:**
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

4. **Set the allowlist** — edit `vars.ALLOWED_GITHUB_LOGINS` in `wrangler.jsonc` to your
   GitHub login (comma/space-separated for several). **An empty allowlist denies everyone**
   (fail closed).

5. **Deploy:**
   ```bash
   npm run deploy   # runs build:lib, then wrangler deploy
   ```

## Connect a client

Point an MCP client at the **Streamable HTTP** endpoint and complete the GitHub login:

```
https://seo-mcp.<your-subdomain>.workers.dev/mcp
```

Quick test with the MCP Inspector:
```bash
npx @modelcontextprotocol/inspector@latest
# connect to https://seo-mcp.<subdomain>.workers.dev/mcp, authorize via GitHub,
# then call:  check_page { "url": "https://example.com/" }
```

## Develop

```bash
npm install
npm test            # vitest — pure tool logic + auth gate (pretest builds the core lib)
npm run typecheck   # tsc --noEmit
npm run dev         # wrangler dev (local)
npx wrangler deploy --dry-run --outdir /tmp/b   # verify the bundle without deploying
```

## Security notes

- **Allowlist is the authz gate.** OAuth proves *who* you are (GitHub); the
  `ALLOWED_GITHUB_LOGINS` allowlist decides *whether* you may call the tools. Fail-closed.
- **SSRF surface.** The tools fetch caller-supplied URLs. Gated to your own GitHub login this
  is low-risk, but a future multi-user/public deployment should filter private / loopback /
  link-local IP ranges (e.g. `ssrf-req-filter`) before fetching, and consider adding the
  approval-dialog / CSRF-cookie flow from Cloudflare's official `remote-mcp-github-oauth`
  template (this server uses a leaner KV-state CSRF protection sufficient for a single owner).
- Orphan / broken-link detection is one-hop and static-HTML only (inherited from the core).
