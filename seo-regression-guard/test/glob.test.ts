import { describe, it, expect } from 'vitest';
import { matchGlob, isIgnored } from '../src/glob.js';

describe('matchGlob', () => {
  it('exact match when no wildcard', () => {
    expect(matchGlob('/a', '/a')).toBe(true);
    expect(matchGlob('/a', '/b')).toBe(false);
  });

  it('* matches any tail', () => {
    expect(matchGlob('/blog/*', '/blog/post-1')).toBe(true);
    expect(matchGlob('/blog/*', '/blog/')).toBe(true);
    expect(matchGlob('/blog/*', '/shop/x')).toBe(false);
  });

  it('* matches an internal segment', () => {
    expect(matchGlob('/*/edit', '/users/edit')).toBe(true);
    expect(matchGlob('/*/edit', '/users/view')).toBe(false);
  });

  it('isIgnored matches if any glob matches', () => {
    expect(isIgnored('/draft/x', ['/blog/*', '/draft/*'])).toBe(true);
    expect(isIgnored('/about', ['/blog/*'])).toBe(false);
  });
});
