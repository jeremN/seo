import { describe, it, expect } from 'vitest';
import { structuredDataFindings } from '../src/structured-data.js';

// Build a valid jsonLd entry from a node object (types derived from its @type).
const ld = (obj: Record<string, unknown>) => {
  const t = obj['@type'];
  const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
  return { valid: true as const, types, node: obj };
};

const ARTICLE_FULL = {
  '@type': 'Article', headline: 'H', image: 'https://x.com/i.jpg', datePublished: '2024-01-15',
  dateModified: '2024-01-15', author: { name: 'a' }, publisher: { name: 'p' },
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
      offers: { price: '9', priceCurrency: 'EUR', availability: 'InStock', url: 'https://x.com/buy' },
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

describe('structuredDataFindings — value formats', () => {
  const product = (over: Record<string, unknown>) =>
    ld({ '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd', ...over });
  // A complete, well-formed Offer except the field(s) under test.
  const offer = (over: Record<string, unknown>) =>
    product({ offers: { price: '9.99', priceCurrency: 'EUR', availability: 'InStock', url: 'https://x.com/buy', ...over } });

  // --- number ---
  it('flags a non-numeric Offer price as a warning on Offer.price', () => {
    const w = structuredDataFindings([offer({ price: 'free' })], '/p').find((f) => f.severity === 'warning');
    expect(w?.message).toContain('Offer.price');
    expect(w?.message).toContain('invalide');
    expect(w?.after).toBe('free');
  });
  it('accepts a numeric Offer price as string or number', () => {
    expect(structuredDataFindings([offer({ price: '9.99' })], '/p')).toEqual([]);
    expect(structuredDataFindings([offer({ price: 9.99 })], '/p')).toEqual([]);
  });

  // --- currency ---
  it('flags a non-ISO-4217 priceCurrency (symbol or lowercase) as a warning', () => {
    const bad = (c: unknown) =>
      structuredDataFindings([offer({ priceCurrency: c })], '/p').some((f) => f.severity === 'warning' && f.message.includes('priceCurrency'));
    expect(bad('€')).toBe(true);
    expect(bad('eur')).toBe(true);
  });
  it('accepts a 3-letter uppercase priceCurrency', () => {
    expect(structuredDataFindings([offer({ priceCurrency: 'EUR' })], '/p')).toEqual([]);
  });

  // --- date ---
  it('flags a malformed Article date as a warning', () => {
    const bad = (d: string) =>
      structuredDataFindings([ld({ ...ARTICLE_FULL, datePublished: d })], '/p').some((f) => f.severity === 'warning' && f.message.includes('datePublished'));
    expect(bad('hier')).toBe(true);
    expect(bad('2024-13-40')).toBe(true);
    expect(bad('2024/01/15')).toBe(true);
  });
  it('accepts ISO-8601 date and datetime', () => {
    expect(structuredDataFindings([ld({ ...ARTICLE_FULL, datePublished: '2024-01-15' })], '/p')).toEqual([]);
    expect(structuredDataFindings([ld({ ...ARTICLE_FULL, datePublished: '2024-01-15T10:30:00Z' })], '/p')).toEqual([]);
  });

  // --- rating ---
  it('flags an out-of-range ratingValue on the default 1–5 scale', () => {
    const w = structuredDataFindings([product({ aggregateRating: { ratingValue: 6, reviewCount: '10' } })], '/p')
      .find((f) => f.severity === 'warning' && f.message.includes('ratingValue'));
    expect(w).toBeDefined();
  });
  it('accepts an in-range ratingValue and a custom bestRating', () => {
    expect(structuredDataFindings([product({ aggregateRating: { ratingValue: 4.5, reviewCount: '10' } })], '/p')).toEqual([]);
    expect(structuredDataFindings([product({ aggregateRating: { ratingValue: 8, bestRating: 10, reviewCount: '10' } })], '/p')).toEqual([]);
  });

  // --- url ---
  it('flags a relative url as info, not warning', () => {
    const fmt = structuredDataFindings([ld({ '@type': 'Organization', name: 'O', url: '/x' })], '/p')
      .find((x) => x.message.includes('url') && x.message.includes('invalide'));
    expect(fmt?.severity).toBe('info');
  });
  it('accepts an absolute http(s) url and an object-valued logo', () => {
    expect(structuredDataFindings([ld({
      '@type': 'Organization', name: 'O', url: 'https://x.com',
      logo: { '@type': 'ImageObject', url: 'https://x' }, sameAs: 'https://x', contactPoint: {},
    })], '/p')).toEqual([]);
  });
  it('validates every element of a url array (sameAs) → info on a bad element', () => {
    const fmt = structuredDataFindings([ld({
      '@type': 'Organization', name: 'O', url: 'https://x.com', logo: 'https://x',
      sameAs: ['https://x', '/y'], contactPoint: {},
    })], '/p').find((x) => x.message.includes('sameAs') && x.message.includes('invalide'));
    expect(fmt?.severity).toBe('info');
  });

  // --- interaction with the presence pass (no double-report) ---
  it('a present-but-malformed value fires a format finding only', () => {
    const warns = structuredDataFindings([offer({ price: 'free' })], '/p').filter((f) => f.severity === 'warning');
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('Offer.price');
    expect(warns[0].message).toContain('invalide');
  });
  it('an absent value fires a presence finding only', () => {
    const warns = structuredDataFindings([product({ offers: { priceCurrency: 'EUR', availability: 'InStock', url: 'https://x.com/buy' } })], '/p')
      .filter((f) => f.severity === 'warning');
    expect(warns).toHaveLength(1);
    expect(warns[0].after).toContain('price');
    expect(warns[0].message).not.toContain('invalide');
  });

  // --- dedupe ---
  it('dedupes identical format findings across nodes', () => {
    const two = [offer({ price: 'free' }), offer({ price: 'free' })];
    expect(structuredDataFindings(two, '/p').filter((f) => f.severity === 'warning')).toHaveLength(1);
  });
});
