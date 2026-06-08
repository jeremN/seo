import type { Finding, Severity } from './types.js';

export const MARKER = '<!-- seo-regression-guard -->';
const ORDER: Severity[] = ['critical', 'warning', 'info'];
const ICON: Record<Severity, string> = { critical: '🔴', warning: '🟡', info: 'ℹ️' };

export type FailOn = 'none' | 'critical' | 'warning';

// Échappe le contenu d'une cellule de table markdown : un `|` ou un retour
// ligne dans un title/canonical réel casserait l'alignement du commentaire.
function cell(value: string | null): string {
  if (value == null) return '—';
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
}

export function report(
  findings: Finding[],
  opts: { failOn: FailOn; pageCount: number },
): { markdown: string; shouldFail: boolean } {
  const shouldFail =
    opts.failOn === 'none' ? false
    : opts.failOn === 'warning' ? findings.some((f) => f.severity === 'critical' || f.severity === 'warning')
    : findings.some((f) => f.severity === 'critical');

  if (findings.length === 0) {
    return {
      markdown: `${MARKER}\n## seo-regression-guard\n✅ Aucune régression SEO détectée sur ${opts.pageCount} pages.`,
      shouldFail: false,
    };
  }

  const summary = ORDER
    .map((s) => ({ s, n: findings.filter((f) => f.severity === s).length }))
    .filter(({ n }) => n > 0)
    .map(({ s, n }) => `${ICON[s]} ${n} ${s}`)
    .join(' · ');

  let body = `${MARKER}\n## seo-regression-guard\n${summary} — ${opts.pageCount} pages analysées.\n`;
  for (const s of ORDER) {
    const items = findings.filter((f) => f.severity === s);
    if (!items.length) continue;
    body += `\n<details${s === 'critical' ? ' open' : ''}><summary>${ICON[s]} ${items.length} ${s}</summary>\n\n`;
    body += '| Page | Signal | Avant | Après |\n|---|---|---|---|\n';
    for (const f of items) {
      body += `| \`${f.path}\` | ${f.signal} | ${cell(f.before)} | ${cell(f.after)} |\n`;
    }
    body += '\n</details>\n';
  }
  body += `\n<sub>Catch SEO regressions before they ship · hosted version (waitlist) →</sub>`;
  return { markdown: body, shouldFail };
}
