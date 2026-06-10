import { describe, it, expect } from 'vitest';
import { isValidHreflang } from '../src/hreflang.js';

describe('isValidHreflang', () => {
  it('accepts language, language-region, and script subtags', () => {
    for (const ok of ['en', 'fr', 'de', 'en-GB', 'pt-BR', 'zh-Hant', 'zh-Hant-HK']) {
      expect(isValidHreflang(ok)).toBe(true);
    }
  });

  it('accepts x-default case-insensitively', () => {
    expect(isValidHreflang('x-default')).toBe(true);
    expect(isValidHreflang('X-Default')).toBe(true);
  });

  it('is case-insensitive on the tag', () => {
    expect(isValidHreflang('EN-gb')).toBe(true);
  });

  it('rejects the common real-world errors', () => {
    for (const bad of ['en_US', 'english', 'en-USA', 'e', '', 'en-', 'en GB', 'en/us']) {
      expect(isValidHreflang(bad)).toBe(false);
    }
  });
});
