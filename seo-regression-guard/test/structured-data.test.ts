import { describe, it, expect } from 'vitest';
import { structuredDataFindings } from '../src/structured-data.js';

// Build a valid jsonLd entry from a node object (types derived from its @type).
const ld = (obj: Record<string, unknown>) => {
  const t = obj['@type'];
  const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
  return { valid: true as const, types, node: obj };
};

const ARTICLE_FULL = {
  '@type': 'Article', headline: 'H', image: 'i', datePublished: 'd',
  dateModified: 'd', author: { name: 'a' }, publisher: { name: 'p' },
};

describe('structuredDataFindings', () => {
  it('flags a Product missing the offers/review/aggregateRating group (warning)', () => {
    const warn = structuredDataFindings([ld({ '@type': 'Product', name: 'X' })], '/p')
      .find((f) => f.severity === 'warning');
    expect(warn).toBeDefined();
    expect(warn?.signal).toBe('structured-data');
    expect(warn?.after).toContain('offers|review|aggregateRating');
  });

  it('no findings for a complete Product', () => {
    const f = structuredDataFindings([ld({
      '@type': 'Product', name: 'X', offers: { price: '9' }, image: 'i', brand: 'b', sku: 's', description: 'd',
    })], '/p');
    expect(f).toEqual([]);
  });

  it('flags a missing required field (Article headline) as warning, complete Article as none', () => {
    expect(structuredDataFindings([ld({ '@type': 'Article' })], '/p').some((f) => f.severity === 'warning')).toBe(true);
    expect(structuredDataFindings([ld(ARTICLE_FULL)], '/p')).toEqual([]);
  });

  it('flags a missing recommended field as info (no warning)', () => {
    const { image, ...noImage } = ARTICLE_FULL; void image;
    const f = structuredDataFindings([ld(noImage)], '/p');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('info');
    expect(f[0].after).toContain('image');
  });

  it('resolves subtypes via aliasing (NewsArticle→Article, Restaurant→LocalBusiness)', () => {
    expect(structuredDataFindings([ld({ ...ARTICLE_FULL, '@type': 'NewsArticle' })], '/p')).toEqual([]);
    const r = structuredDataFindings([ld({ '@type': 'Restaurant', name: 'R' })], '/p');
    expect(r.some((f) => f.severity === 'warning' && f.after?.includes('address'))).toBe(true);
  });

  it('ignores unknown @types', () => {
    expect(structuredDataFindings([ld({ '@type': 'WebSite', url: 'u' })], '/p')).toEqual([]);
  });

  it('treats empty string and empty array as missing', () => {
    expect(structuredDataFindings([ld({ '@type': 'Article', headline: '' })], '/p').some((f) => f.severity === 'warning')).toBe(true);
    expect(structuredDataFindings([ld({ '@type': 'BreadcrumbList', itemListElement: [] })], '/p').some((f) => f.severity === 'warning')).toBe(true);
  });

  it('skips invalid nodes', () => {
    expect(structuredDataFindings([{ valid: false, types: [], node: null }], '/p')).toEqual([]);
  });

  it('dedupes identical findings across same-shaped nodes', () => {
    const two = [ld({ '@type': 'Product', name: 'X' }), ld({ '@type': 'Product', name: 'Y' })];
    expect(structuredDataFindings(two, '/p').filter((f) => f.severity === 'warning')).toHaveLength(1);
  });
});
