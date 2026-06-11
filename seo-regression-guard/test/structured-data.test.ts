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
      '@type': 'Product', name: 'X',
      offers: { price: '9', priceCurrency: 'EUR', availability: 'InStock', url: 'u' },
      image: 'i', brand: 'b', sku: 's', description: 'd',
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

describe('structuredDataFindings — nested depth', () => {
  // A complete Product (top-level), so only nested findings surface.
  const product = (over: Record<string, unknown>) =>
    ld({ '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd', ...over });

  it('flags an Offer missing priceCurrency (Product › Offer warning)', () => {
    const w = structuredDataFindings([product({ offers: { price: '9' } })], '/p').find((f) => f.severity === 'warning');
    expect(w?.message).toContain('Offer');
    expect(w?.after).toContain('priceCurrency');
  });

  it('does not dig into a string/URL offers shorthand', () => {
    expect(structuredDataFindings([product({ offers: 'https://x.com/buy' })], '/p')).toEqual([]);
  });

  it('flags an empty offers object as a nested Offer warning', () => {
    const w = structuredDataFindings([product({ offers: {} })], '/p').find((f) => f.severity === 'warning');
    expect(w?.message).toContain('Offer');
    expect(w?.after).toContain('price');
  });

  it('validates two levels deep: FAQ Question → Answer.text', () => {
    const f = structuredDataFindings([ld({
      '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer' } }],
    })], '/p');
    const w = f.find((x) => x.severity === 'warning');
    expect(w?.message).toContain('Answer');
    expect(w?.after).toContain('text');
  });

  it('no findings for a complete FAQ', () => {
    expect(structuredDataFindings([ld({
      '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } }],
    })], '/p')).toEqual([]);
  });

  it('flags a breadcrumb ListItem missing item and dedupes same-shaped elements', () => {
    const warns = structuredDataFindings([ld({
      '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', name: 'a', position: 1 },
        { '@type': 'ListItem', name: 'b', position: 2 },
      ],
    })], '/p').filter((f) => f.severity === 'warning');
    expect(warns).toHaveLength(1);
    expect(warns[0].after).toContain('item');
  });

  it('no nested finding when breadcrumb items are complete', () => {
    expect(structuredDataFindings([ld({
      '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', name: 'a', item: 'https://x.com/a', position: 1 }],
    })], '/p')).toEqual([]);
  });

  it('flags AggregateRating missing both count props', () => {
    const w = structuredDataFindings([product({ aggregateRating: { ratingValue: '4.5' } })], '/p')
      .find((f) => f.severity === 'warning' && f.message.includes('AggregateRating'));
    expect(w?.after).toContain('reviewCount|ratingCount');
  });

  it('flags PostalAddress missing locality/country', () => {
    const w = structuredDataFindings([ld({
      '@type': 'LocalBusiness', name: 'N', address: { streetAddress: 's' },
      telephone: 't', openingHoursSpecification: {}, geo: { latitude: 1, longitude: 2 }, priceRange: '$', url: 'u', image: 'i',
    })], '/p').find((f) => f.severity === 'warning' && f.message.includes('PostalAddress'));
    expect(w?.after).toContain('addressLocality');
    expect(w?.after).toContain('addressCountry');
  });

  it('treats geo 0,0 as present (no GeoCoordinates warning)', () => {
    const f = structuredDataFindings([ld({
      '@type': 'LocalBusiness', name: 'N',
      address: { streetAddress: 's', addressLocality: 'l', addressCountry: 'c' },
      geo: { latitude: 0, longitude: 0 },
    })], '/p');
    expect(f.some((x) => x.severity === 'warning')).toBe(false);
  });
});
