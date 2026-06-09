import type { RobotsRule } from './types.js';

export function parseRobots(txt: string): RobotsRule {
  const disallow: string[] = [];
  let appliesToAll = false;
  for (const raw of txt.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') appliesToAll = value === '*';
    else if (key === 'disallow' && appliesToAll && value) disallow.push(value);
  }
  return { disallow };
}

export function isDisallowed(rule: RobotsRule, path: string): boolean {
  return rule.disallow.some((p) => path.startsWith(p));
}
