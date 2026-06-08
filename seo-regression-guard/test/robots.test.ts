import { describe, it, expect } from 'vitest';
import { parseRobots, isDisallowed } from '../src/robots.js';

describe('robots', () => {
  it('extrait les Disallow du groupe User-agent: *', () => {
    const txt = 'User-agent: *\nDisallow: /admin\nDisallow: /tmp # commentaire\n\nUser-agent: Bad\nDisallow: /';
    expect(parseRobots(txt).disallow).toEqual(['/admin', '/tmp']);
  });

  it('isDisallowed matche par préfixe', () => {
    const rule = { disallow: ['/admin'] };
    expect(isDisallowed(rule, '/admin/users')).toBe(true);
    expect(isDisallowed(rule, '/public')).toBe(false);
  });
});
