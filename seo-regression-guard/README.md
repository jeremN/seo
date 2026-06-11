# 🔍 SEO Regression Guard

Catch SEO regressions **before they ship**. On every PR, it diffs the SEO-critical
signals of each page between **production** (known-good) and your **preview deploy**,
and comments the regressions on the PR — blocking only on the irreversible stuff.

> "You just shipped a `noindex` on `/pricing`." — the comment that saves a launch.

Zero Google auth, zero API keys, zero stored state. Pure deterministic HTML/header
diffing between two live deploys.

---

## Quick start

1. Make sure your CI produces a **preview deployment URL** for each PR (Vercel,
   Netlify, Cloudflare Pages, etc. all expose one).
2. Add a workflow to **your** repo at `.github/workflows/seo.yml`
   (full copy-paste version in [`examples/seo.yml`](./examples/seo.yml)):

```yaml
name: SEO Regression Guard
on: pull_request

permissions:
  contents: read
  pull-requests: write   # required to post the PR comment

jobs:
  seo-guard:
    runs-on: ubuntu-latest
    steps:
      # Provide the PR's preview URL however your platform exposes it.
      # - id: deploy
      #   uses: your-preview-provider/action@<sha>

      - uses: jeremN/seo/seo-regression-guard@v0   # pin to a tag or commit SHA
        with:
          prod-url: https://your-site.com
          preview-url: ${{ steps.deploy.outputs.preview-url }}
          # fail-on: critical   # none | critical | warning  (default: critical)
```

> **Tip:** pin the action to a commit SHA (`@<sha>`) rather than a moving tag for a
> hardened supply chain.

---

## How it works

For each page it discovers (via the preview's `sitemap.xml`, a sitemap **index**, or
an explicit `paths` list), it fetches the page on **prod** and on **preview**, extracts
the SEO signals from each, and reports the differences. The page set is bounded by
`max-pages` (pages beyond the cap are logged, never silently dropped). If **zero** pages
are discovered, it warns loudly instead of showing a misleading green check.

The check **blocks the merge** only when a finding meets the `fail-on` threshold
(default: `critical`). Everything else is advisory.

### What it checks

| Signal | Regression detected | Severity |
|---|---|---|
| Indexability | `noindex` newly introduced via `<meta robots>` or robots.txt | 🔴 critical |
| Canonical | removed, or now points off-domain | 🔴 critical |
| Canonical | now points to a different on-site path | 🟡 warning |
| Status | prod 2xx → preview 5xx, or a new / changed redirect (compared by path) | 🔴 critical |
| Page removed | a previously-live URL now 404s | 🔴 critical |
| Title | removed (changed → ℹ️ info) | 🟡 warning |
| Meta description | removed | 🟡 warning |
| H1 | removed, or count 1 → 0 / 1 → many | 🟡 warning |
| Structured data | JSON-LD removed, or now invalid JSON | 🟡 warning |
| Internal links | a link to an internal URL that now 404s (one-hop checked) | 🟡 warning |
| Orphan pages | a page no other page links to (from static HTML) | 🟡 warning |
| Social tags | Open Graph tags removed (link previews break) | 🟡 warning |
| Viewport | `<meta name=viewport>` removed (mobile rendering) | 🟡 warning |
| Canonical (duplicate) | multiple `<link rel=canonical>` newly introduced | 🟡 warning |
| hreflang | hreflang annotations removed (international targeting lost) | 🟡 warning |

New pages (present in preview, absent in prod) are reported as ℹ️ info and never block.

> The **`audit`** command (CLI / MCP) additionally runs absolute head/meta hygiene checks that
> would be noise in a PR diff: missing viewport (warning) / charset / Open Graph (info),
> duplicate canonical (warning), title (30–60) / meta-description (70–160) length (info), and
> **hreflang** validation (invalid code / missing self-reference / duplicate → warning; missing
> `x-default` → info).

> **Core Web Vitals (opt-in, audit-only).** Pass a [CrUX API key](https://developer.chrome.com/docs/crux/api)
> via `--crux-key` (or the `CRUX_API_KEY` env var; MCP reads it from a Worker secret) and `audit`
> also reports real-user p75 field data — **LCP** (≤2500ms good, >4000ms poor), **INP** (≤200ms,
> >500ms), **CLS** (≤0.10, >0.25): poor → 🟡 warning, needs-improvement → ℹ️ info, good → nothing.
> Field data only exists for live, trafficked URLs, so this never runs on the guard/diff surface.
> No key, no field data (404), or any CrUX error yields no findings — it **never fails the audit**.

> **Why `X-Robots-Tag` headers are ignored for noindex:** preview hosts (Cloudflare Pages,
> Vercel, Netlify…) inject `X-Robots-Tag: noindex` on *every* preview deployment to keep
> previews out of search. That's environment noise, not a code regression — so only
> `<meta robots>` / robots.txt noindex (which your PR actually controls) is flagged.
> Likewise, redirects are compared by **path**, so a same-site redirect that only differs
> by host between prod and preview is not a false "redirect changed".

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `prod-url` | ✅ | — | Base URL of production (the known-good) |
| `preview-url` | ✅ | — | Base URL of the PR preview deployment |
| `paths` | — | — | Newline-separated paths to check (overrides sitemap) |
| `sitemap` | — | `<preview-url>/sitemap.xml` | Sitemap URL (supports `<sitemapindex>`) |
| `max-pages` | — | `50` | Max pages analyzed (overflow is logged) |
| `fail-on` | — | `critical` | `none` \| `critical` \| `warning` |
| `ignore-paths` | — | — | Newline-separated globs to neutralize findings (`*` wildcard) |
| `github-token` | — | `${{ github.token }}` | Token used to upsert the PR comment |

The comment is a single **sticky** comment (updated in place on each push), found via a
hidden marker and paginated lookup so it never duplicates on busy PRs.

---

## What it is *not* (yet)

- **Not** a Google Search Console integration. GSC-based post-deploy alerting
  (deindexation, traffic drops) and result attribution are on the roadmap (layer 3).
- Orphan detection sees **static-HTML** links only — pages linked exclusively via
  client-side-rendered navigation may be reported as orphans.
- **Not** a Core Web Vitals monitor.

It only compares two live deploys. That's the whole point: deterministic, cheap, and
runnable on every PR with no credentials.

---

## CLI (`seo-guard`)

The same deterministic core ships as a command-line tool with two verbs — usable
locally, in any CI, or by an AI agent. See [`AGENTS.md`](./AGENTS.md) for the
agent-facing contract.

```bash
cd seo-regression-guard
npm install
npm run build:cli      # bundles src/cli.ts → dist-cli/index.js (ncc)
npm link               # exposes `seo-guard` on your PATH
```

- **`seo-guard guard`** — the Action's prod↔preview diff, on the command line:

  ```bash
  seo-guard guard --prod https://your-site.com \
                  --preview https://pr-123.your-site.dev \
                  --fail-on critical
  ```

- **`seo-guard audit`** — the "perso" feature: an **absolute** single-site SEO audit
  (no preview needed). Discovers pages via `<url>/sitemap.xml` by default, lints each
  page against best practices, and runs the orphan/broken-link crawl:

  ```bash
  seo-guard audit --url https://your-site.com               # human table
  seo-guard audit --url https://your-site.com --json        # machine-readable
  seo-guard audit --url https://your-site.com --paths / --paths /pricing
  ```

Both honor `--paths`, `--sitemap`, `--max-pages`, `--ignore '<glob>'`, and `--json`.
Human output is a compact, critical-first table; `--json` emits the versioned
`seo-guard/v1` contract on stdout (errors and logs go to stderr). Color is disabled
automatically when `NO_COLOR` is set or stdout is not a TTY.

**Exit codes:** `0` ok · `1` findings reached the threshold (or a runtime failure) ·
`2` usage error · `3` config error (no `--paths` and sitemap unreachable).

> `audit` flags `noindex` from **any** source (it's auditing one real site), whereas
> `guard` ignores preview `X-Robots-Tag` header noise. That's the one intentional
> difference between the two commands' indexability checks.

---

## Local development

```bash
cd seo-regression-guard
npm install
npm test            # vitest, 74 tests
npx tsc --noEmit    # strict typecheck
npm run build       # bundles src/main.ts → dist/index.js   (the Action)
npm run build:cli   # bundles src/cli.ts  → dist-cli/index.js (the CLI)
```

> Both bundles are **committed**. A JS GitHub Action runs `dist/index.js`, and the
> `seo-guard` CLI is distributed as `dist-cli/index.js`. After changing any source,
> rebuild and commit both. CI fails if either is stale
> (`git diff --exit-code dist` / `dist-cli`).

## License

MIT
