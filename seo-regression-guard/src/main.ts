import * as core from '@actions/core';
import * as github from '@actions/github';
import { analyze } from './analyze.js';
import { report, MARKER, type FailOn } from './report.js';

export async function run(): Promise<void> {
  try {
    const prodUrl = core.getInput('prod-url', { required: true });
    const previewUrl = core.getInput('preview-url', { required: true });
    const pathsInput = core.getInput('paths');
    const sitemap = core.getInput('sitemap') || new URL('/sitemap.xml', previewUrl).toString();
    const maxPages = parseInt(core.getInput('max-pages') || '50', 10);
    const failOn = (core.getInput('fail-on') || 'critical') as FailOn;
    const ignorePaths = core.getInput('ignore-paths').split('\n').map((s) => s.trim()).filter(Boolean);
    const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';

    const parsedPaths = pathsInput.split('\n').map((s) => s.trim()).filter(Boolean);
    const paths = parsedPaths.length > 0 ? parsedPaths : undefined;

    const { findings, pageCount } = await analyze({
      prodUrl, previewUrl, paths,
      sitemapUrl: paths ? undefined : sitemap,
      maxPages, ignorePaths, log: core.info,
    });

    const { markdown, shouldFail } = report(findings, { failOn, pageCount });
    await upsertComment(token, markdown);

    if (shouldFail) core.setFailed(`Régression SEO détectée (fail-on=${failOn}).`);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

async function upsertComment(token: string, body: string): Promise<void> {
  const ctx = github.context;
  if (!token || !ctx.payload.pull_request) {
    core.info('Pas de PR ou pas de token : commentaire ignoré.');
    return;
  }
  try {
    const octokit = github.getOctokit(token);
    const { owner, repo } = ctx.repo;
    const issue_number = ctx.payload.pull_request.number;
    // Paginate so the sticky comment is found even on PRs with >30 comments
    // (listComments defaults to 30/page) — otherwise we'd post a duplicate.
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner, repo, issue_number, per_page: 100,
    });
    const existing = comments.find((c) => c.body?.includes(MARKER));
    if (existing) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    } else {
      await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
    }
  } catch (err) {
    // Le commentaire est secondaire : le code de sortie reste la source de vérité.
    core.warning(`Échec de l'upsert du commentaire: ${err instanceof Error ? err.message : String(err)}`);
  }
}

run();
