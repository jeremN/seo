#!/usr/bin/env node
import { cac } from 'cac';
import { analyze } from './analyze.js';
import { audit } from './audit.js';
import {
  reportJson, errorJson, renderHuman, meetsThreshold, type Renderable,
} from './cli-render.js';
import type { FailOn } from './report.js';

const VERSION = '0.1.0';
const FAIL_ON: FailOn[] = ['none', 'critical', 'warning'];

// --- helpers ---------------------------------------------------------------

// Human colour only when writing to a real TTY and NO_COLOR is unset. Never in
// --json mode (stdout is the structured contract there).
const useColor = (json: boolean): boolean => !json && !!process.stdout.isTTY && !process.env.NO_COLOR;

// cac yields a string for `--opt v`, an array for repeated `--opt a --opt b`.
// Also accept comma-separated values. Returns undefined when empty.
function splitList(v: unknown): string[] | undefined {
  if (v == null || v === '') return undefined;
  const arr = (Array.isArray(v) ? v : [v])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

// Clamp --max-pages to a positive integer; a bad value must NOT become NaN, which
// would unbound the maillage one-hop fetch budget.
function safeMaxPages(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

const logToStderr = (m: string): void => { process.stderr.write(`${m}\n`); };

// Reports go to stdout (the contract); chrome/errors go to stderr.
function emit(command: 'guard' | 'audit', result: Renderable, json: boolean): void {
  const out = json
    ? JSON.stringify(reportJson(command, result))
    : renderHuman(result, { color: useColor(json) });
  process.stdout.write(`${out}\n`);
}

// Errors always land on stderr — never pollute the stdout report stream.
function fail(message: string, hint: string, exitCode: number, json: boolean): never {
  const payload = json
    ? JSON.stringify(errorJson(message, hint, exitCode))
    : `✗ ${message}\n  → ${hint}`;
  process.stderr.write(`${payload}\n`);
  process.exit(exitCode);
}

// Map a thrown error to an exit code + recovery hint. Config problems (missing or
// unreachable sitemap, no discovery source) are 3; everything else is a runtime
// failure of the underlying crawl (1).
function classify(err: unknown): { message: string; hint: string; exitCode: number } {
  const message = err instanceof Error ? err.message : String(err);
  if (/sitemap|Config:/i.test(message)) {
    return { message, hint: 'fournir --paths <p>… ou un --sitemap <url> atteignable', exitCode: 3 };
  }
  return { message, hint: "vérifier la connectivité réseau et l'URL, puis réessayer", exitCode: 1 };
}

// --- CLI -------------------------------------------------------------------

const cli = cac('seo-guard');

cli
  .command('guard', 'Compare les signaux SEO entre la prod et un déploiement preview')
  .option('--prod <url>', 'URL de base de la production')
  .option('--preview <url>', 'URL de base de la preview / PR')
  .option('--paths <path>', 'Chemin(s) explicite(s) à vérifier (répétable ou séparé par des virgules)')
  .option('--sitemap <url>', 'URL du sitemap (défaut : <preview>/sitemap.xml)')
  .option('--max-pages <n>', 'Nombre maximum de pages à crawler', { default: 50 })
  .option('--fail-on <level>', 'Sortie 1 dès qu’un finding atteint ce niveau : none|critical|warning', { default: 'critical' })
  .option('--ignore <glob>', 'Ignore les findings sur les chemins correspondants (répétable)')
  .option('--json', 'Émet du JSON machine (seo-guard/v1) sur stdout')
  .example('seo-guard guard --prod https://site.com --preview https://preview.site.com --paths / --paths /pricing')
  .example('seo-guard guard --prod https://site.com --preview https://preview.site.com --json')
  .action(async (opts) => {
    const json = !!opts.json;
    if (!opts.prod || !opts.preview) {
      fail('Options requises manquantes : --prod et --preview.', 'seo-guard guard --prod <url> --preview <url> --paths /', 2, json);
    }
    const failOn = String(opts.failOn) as FailOn;
    if (!FAIL_ON.includes(failOn)) {
      fail(`--fail-on invalide : ${failOn}.`, 'seo-guard guard … --fail-on critical', 2, json);
    }
    const paths = splitList(opts.paths);
    try {
      const result = await analyze({
        prodUrl: opts.prod,
        previewUrl: opts.preview,
        paths,
        sitemapUrl: paths ? undefined : (opts.sitemap ?? new URL('/sitemap.xml', opts.preview).toString()),
        maxPages: safeMaxPages(opts.maxPages),
        ignorePaths: splitList(opts.ignore),
        log: logToStderr,
      });
      emit('guard', result, json);
      process.exit(meetsThreshold(result.findings, failOn) ? 1 : 0);
    } catch (err) {
      const { message, hint, exitCode } = classify(err);
      fail(message, hint, exitCode, json);
    }
  });

cli
  .command('audit', 'Audite un seul site en absolu contre les bonnes pratiques SEO')
  .option('--url <url>', 'URL de base du site à auditer')
  .option('--paths <path>', 'Chemin(s) explicite(s) à auditer (répétable ou séparé par des virgules)')
  .option('--sitemap <url>', 'URL du sitemap (défaut : <url>/sitemap.xml)')
  .option('--max-pages <n>', 'Nombre maximum de pages à crawler', { default: 50 })
  .option('--ignore <glob>', 'Ignore les findings sur les chemins correspondants (répétable)')
  .option('--json', 'Émet du JSON machine (seo-guard/v1) sur stdout')
  .example('seo-guard audit --url https://site.com')
  .example('seo-guard audit --url https://site.com --max-pages 100 --json')
  .action(async (opts) => {
    const json = !!opts.json;
    if (!opts.url) {
      fail('Option requise manquante : --url.', 'seo-guard audit --url <url>', 2, json);
    }
    const paths = splitList(opts.paths);
    try {
      const result = await audit({
        url: opts.url,
        paths,
        sitemapUrl: opts.sitemap,
        maxPages: safeMaxPages(opts.maxPages),
        ignorePaths: splitList(opts.ignore),
        log: logToStderr,
      });
      emit('audit', result, json);
      // audit fails the run on any critical (e.g. a non-2xx page).
      process.exit(result.findings.some((f) => f.severity === 'critical') ? 1 : 0);
    } catch (err) {
      const { message, hint, exitCode } = classify(err);
      fail(message, hint, exitCode, json);
    }
  });

// Default command (no subcommand): print help and exit 2 (usage).
cli
  .command('')
  .action(() => {
    cli.outputHelp();
    process.exit(2);
  });

cli.help();
cli.version(VERSION);
cli.parse();
