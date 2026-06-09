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

New pages (present in preview, absent in prod) are reported as ℹ️ info and never block.

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

## Local development

```bash
cd seo-regression-guard
npm install
npm test            # vitest, 44 tests
npx tsc --noEmit    # strict typecheck
npm run build       # bundles src/main.ts → dist/index.js (ncc)
```

> A JS GitHub Action runs the **committed bundle** `dist/index.js`, not `src/`. After
> changing any source, run `npm run build` and commit `dist/`. CI fails if `dist/` is
> stale (`git diff --exit-code dist`).

## License

MIT
