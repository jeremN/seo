# 🔍 seo-regression-guard

**Catch SEO regressions in a pull request — before they ship.**

[![CI](https://github.com/jeremN/seo/actions/workflows/ci.yml/badge.svg)](https://github.com/jeremN/seo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Zero auth](https://img.shields.io/badge/Google_auth-none-blue)
![Runs on](https://img.shields.io/badge/runs-every_PR-blueviolet)

You shipped a `noindex` on `/pricing`. Nobody noticed until traffic cratered three weeks
later. **seo-regression-guard** diffs the SEO-critical signals of every page between your
**production** site and your PR's **preview deploy**, and comments the regressions right on
the PR — blocking the merge only on the irreversible stuff.

<!-- Replace with a real GIF once recorded (the site_test PR going 🔴 → ✅ is a perfect clip). -->
<p align="center"><img src="docs/demo.gif" alt="seo-regression-guard commenting on a PR" width="720"></p>

---

## What you get on the PR

> ## seo-regression-guard
> 🔴 1 critical — 2 pages analysées.
>
> | Page | Signal | Before | After |
> |---|---|---|---|
> | `/` | indexability | indexable | noindex (meta) |

One sticky comment, updated in place on every push. The check fails so the merge is blocked
until it's fixed (configurable).

## Quick start

Add `.github/workflows/seo.yml` to your repo:

```yaml
name: SEO Regression Guard
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  seo-guard:
    runs-on: ubuntu-latest
    steps:
      # 1. Get this PR's preview URL (Vercel / Netlify / Cloudflare Pages — see examples/)
      # 2. Guard against regressions:
      - uses: jeremN/seo/seo-regression-guard@v0
        with:
          prod-url: https://your-site.com
          preview-url: ${{ steps.deploy.outputs.preview-url }}
          # fail-on: critical   # none | critical | warning
```

Copy-paste workflows per provider in [`examples/`](seo-regression-guard/examples).
Full docs: [`seo-regression-guard/README.md`](seo-regression-guard/README.md).

## What it checks (zero auth, deterministic)

| Signal | Regression | Severity |
|---|---|---|
| Indexability | `noindex` newly introduced via `<meta robots>` / robots.txt | 🔴 |
| Canonical | removed, or now off-domain | 🔴 |
| Status | 200 → 5xx, or a new / changed redirect (compared by path) | 🔴 |
| Page removed | a previously-live URL now 404s | 🔴 |
| Title / meta / H1 | removed | 🟡 |
| Structured data | JSON-LD removed or now invalid | 🟡 |
| Internal links / orphans | broken internal link, or an unlinked page | 🟡 |
| Head/meta | social tags / viewport / hreflang removed, duplicate canonical introduced | 🟡 |

The **`audit`** command (CLI / MCP) adds absolute single-site checks — head/meta hygiene,
hreflang validation, and **opt-in Core Web Vitals** (real-user LCP / INP / CLS p75 from CrUX
field data, enabled with a `--crux-key`; never fails the audit).

## Why it's not just another SEO tool

- **Lives in your workflow, not a dashboard.** It runs on every PR and blocks the merge —
  no chatbot to remember to ask, no tab to forget to open.
- **Zero Google auth, zero API keys, zero stored state.** It just diffs two live deploys.
- **It understands preview deploys.** Hosts (Cloudflare Pages, Vercel, Netlify) inject
  `X-Robots-Tag: noindex` on *every* preview — naive tools flag every page. This one
  ignores that environment noise and only flags what your code actually changed.
- **Blocks on the irreversible only.** `noindex`, deindexation, 404 on an indexed URL —
  the stuff that quietly tanks rankings. The rest is advisory.

## How it works

```
PR opened ─► fetch each page on  prod  +  preview ─► diff SEO signals ─► sticky PR comment
                                                                       └► fail-on: critical → ❌
```

Deterministic HTML + header diffing. The core (`extract` / `diff` / `report`) is pure and
reused across the Action, a CLI, and an MCP server.

## Also available as

The same deterministic core ships three ways:

- **GitHub Action** — the PR guard above.
- **`seo-guard` CLI** — `seo-guard guard` (prod↔preview diff) and `seo-guard audit --url`
  (absolute single-site audit), with a `--json` contract for agents. See
  [`seo-regression-guard/README.md`](seo-regression-guard/README.md#cli-seo-guard).
- **MCP server** — a remote, OAuth-secured [Model Context Protocol](https://modelcontextprotocol.io)
  server exposing `guard_pr` / `audit_site` / `check_page` as read-only tools for Claude.
  See [`seo-mcp/README.md`](seo-mcp/README.md).

## Not yet (roadmap)

- Google Search Console alerting (post-deploy deindexation, traffic drops) & result attribution
- Core Web Vitals regressions

## Develop

```bash
cd seo-regression-guard && npm install && npm test   # 74 tests
```

## License

MIT
