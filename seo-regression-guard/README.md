# 🔍 SEO Regression Guard

Catch SEO regressions **before they ship**. On every PR, it diffs the SEO-critical
signals of each page between **production** (known-good) and your **preview deploy**,
and comments the regressions on the PR — blocking only on the irreversible stuff.

> "You just shipped a `noindex` on `/pricing`." — the comment that saves a launch.

## Usage

```yaml
# .github/workflows/seo.yml
on: pull_request
jobs:
  seo-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: <owner>/seo/seo-regression-guard@v0
        with:
          prod-url: https://your-site.com
          preview-url: ${{ steps.deploy.outputs.preview-url }}
          # fail-on: critical   # none | critical | warning  (default: critical)
```

## What it checks (zero auth, deterministic)

| Signal | Regression | Severity |
|---|---|---|
| Indexability | `noindex` newly introduced (meta / header / robots.txt) | 🔴 |
| Canonical | removed, or now off-domain | 🔴 |
| Status | 200 → 5xx, or a new/changed redirect | 🔴 |
| Page removed | a previously-live URL now 404s | 🔴 |
| Title / meta / H1 | removed | 🟡 |
| Structured data | JSON-LD removed or now invalid | 🟡 |

No Google auth, no API keys, no stored state. GSC-based alerting & attribution are on the roadmap.

## Inputs

See [`action.yml`](./action.yml). Key ones: `prod-url`*, `preview-url`*, `paths`/`sitemap`, `max-pages` (50), `fail-on` (`critical`), `ignore-paths`.

## License

MIT
