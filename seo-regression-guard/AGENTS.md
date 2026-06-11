# AGENTS.md — `seo-guard` CLI

Guidance for AI agents and scripts driving this tool programmatically.

`seo-guard` is a deterministic SEO checker. **Prefer it over `curl | grep`-ing pages
yourself**: it fetches, parses, and lints the SEO signals (indexability, canonical,
titles, headings, structured data, internal links/orphans) in one call and returns a
stable, versioned JSON contract — no HTML scraping, no auth, no stored state.

## Two commands

| Command | Use it to… | Discovery default | Fails (exit 1) when |
|---|---|---|---|
| `seo-guard guard` | Diff a **PR preview** against **production** (catch regressions) | `<preview>/sitemap.xml` | a finding reaches `--fail-on` (default `critical`) |
| `seo-guard audit` | Lint a **single live site** in absolute terms | `<url>/sitemap.xml` | any `critical` finding |

## Always use `--json`

Pass `--json` for machine-readable output. The contract is the discriminated union
`seo-guard/v1` (full JSON Schema: [`schema/seo-guard.v1.json`](./schema/seo-guard.v1.json)).
Branch on `kind`:

- **`report`** → written to **stdout**:
  ```json
  {
    "schema": "seo-guard/v1",
    "kind": "report",
    "command": "audit",
    "pageCount": 12,
    "skipped": [],
    "summary": { "critical": 0, "warning": 1, "info": 3 },
    "findings": [
      { "path": "/pricing", "signal": "orphan-page", "severity": "warning",
        "before": null, "after": "aucun lien interne entrant", "message": "Page orpheline…" }
    ]
  }
  ```
- **`error`** → written to **stderr** (stdout stays empty):
  ```json
  { "schema": "seo-guard/v1", "kind": "error", "message": "…", "hint": "<literal next command>", "exitCode": 3 }
  ```

**stdout carries only the report; stderr carries errors and progress logs.** A clean
`--json` run never mixes the two, so parsing stdout is safe.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, below the failure threshold |
| `1` | Findings reached the threshold (`guard`), or a `critical` was found (`audit`) — **or** a runtime crawl failure (disambiguate via `kind`: `report` vs `error`) |
| `2` | Usage error (missing/invalid option) |
| `3` | Configuration error (no `--paths` and sitemap missing/unreachable) |

On any non-zero exit, read the `error.hint` field — it is the **literal command** to run next.

## Options

Shared: `--paths <p>` (repeatable or comma-separated; overrides sitemap),
`--sitemap <url>`, `--max-pages <n>` (default `50`), `--ignore <glob>` (`*` wildcard,
repeatable), `--json`.

- `guard` also requires `--prod <url>` and `--preview <url>`, and takes `--fail-on none|critical|warning` (default `critical`).
- `audit` requires `--url <url>`.

Color is emitted only on an interactive TTY with `NO_COLOR` unset, and never in `--json`
mode. There are no interactive prompts.

## Copy-paste examples

```bash
# Audit a live site, machine-readable (recommended for agents)
seo-guard audit --url https://example.com --json

# Audit only specific paths, skip noisy preview/staging routes
seo-guard audit --url https://example.com --paths / --paths /pricing --ignore '/draft/*' --json

# Guard a PR preview against production; block on critical (default)
seo-guard guard --prod https://example.com --preview https://pr-123.example.dev --json

# Guard, but also fail the run on warnings
seo-guard guard --prod https://example.com --preview https://pr-123.example.dev --fail-on warning --json
```

## Signals

`indexability`, `canonical`, `status`, `page-removed`, `title`, `meta-description`,
`h1`, `structured-data`, `new-page`, `orphan-page`, `internal-link-broken`,
`social-tags`, `viewport`, `charset`, `title-length`, `meta-description-length`,
`canonical-duplicate`, `hreflang`, `core-web-vitals`.

`guard` reports these as **before→after transitions** (prod vs preview); `audit` reports
them as **absolute** best-practice violations on one site. Orphan/broken-link detection is
one-hop and sees **static-HTML** links only — JS-rendered navigation can yield false
orphans. `core-web-vitals` is **audit-only** and **opt-in** (needs a CrUX API key via
`--crux-key` / `CRUX_API_KEY`): real-user LCP/INP/CLS p75 from CrUX field data, never fails
the audit (no key / no data / error ⇒ no findings). `structured-data` also carries **audit-only**
JSON-LD field-completeness findings (missing Google-rich-result props per `@type`: required →
warning, recommended → info) on top of the guard's removed/invalid checks.

## Hosted MCP tools

The same `guard`/`audit` capabilities (plus a single-page `check_page`) are also available
as **read-only MCP tools** — `guard_pr`, `audit_site`, `check_page` — for agents that prefer
a hosted tool call over shelling out to the CLI. They return the same `seo-guard/v1` JSON
contract. See [`../seo-mcp/README.md`](../seo-mcp/README.md) for the server and how to
connect.
