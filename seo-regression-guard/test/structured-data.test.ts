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

describe('structuredDataFindings — formats v2: duration', () => {
  // A complete, well-formed Recipe except the time field under test.
  const recipe = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Recipe', name: 'R', image: 'https://x.com/i.jpg',
      recipeIngredient: ['a'], recipeInstructions: 'do', ...over,
    })], '/p');

  it('accepts ISO-8601 durations on Recipe times', () => {
    for (const d of ['PT30M', 'PT1H30M', 'P1DT2H', 'PT0S', 'P1W']) {
      expect(recipe({ totalTime: d }).some((f) => f.severity === 'warning')).toBe(false);
    }
  });
  it('flags a malformed duration as a warning', () => {
    for (const d of ['30 min', 'P', 'PT', '1H30M']) {
      const w = recipe({ totalTime: d }).find((f) => f.severity === 'warning');
      expect(w?.message).toContain('totalTime');
      expect(w?.message).toContain('durée');
    }
  });
  it('checks prepTime and cookTime too', () => {
    expect(recipe({ prepTime: 'PT10M', cookTime: 'oops' }).find((f) => f.severity === 'warning')?.message).toContain('cookTime');
  });
});

describe('structuredDataFindings — formats v2: gtin', () => {
  const product = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd',
      aggregateRating: { ratingValue: 4, reviewCount: '10' }, ...over,
    })], '/p');

  it('accepts a GTIN with a valid check digit', () => {
    expect(product({ gtin13: '4006381333931' }).some((f) => f.severity === 'warning')).toBe(false);
    expect(product({ gtin8: '96385074' }).some((f) => f.severity === 'warning')).toBe(false);
  });
  it('flags a bad check digit, wrong length, or non-digit GTIN', () => {
    for (const g of [{ gtin13: '4006381333932' }, { gtin: '123' }, { gtin: 'abc123' }]) {
      const w = product(g).find((f) => f.severity === 'warning');
      expect(w?.message).toContain('GTIN');
    }
  });
});

describe('structuredDataFindings — formats v2: enums', () => {
  const offer = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd',
      offers: { price: '9', priceCurrency: 'EUR', availability: 'InStock', url: 'https://x.com/buy', ...over },
    })], '/p');
  const event = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Event', name: 'E', startDate: '2024-01-10', location: { '@type': 'Place', name: 'P' },
      endDate: '2024-01-11', image: 'https://x.com/i.jpg', description: 'd',
      offers: { price: '1', priceCurrency: 'EUR' }, eventStatus: 'EventScheduled', ...over,
    })], '/p');

  it('accepts a valid availability, bare and schema.org-URL form', () => {
    expect(offer({ availability: 'InStock' })).toEqual([]);
    expect(offer({ availability: 'https://schema.org/InStock' })).toEqual([]);
  });
  it('flags an invalid availability as info', () => {
    for (const a of ['in stock', 'InStuck']) {
      const f = offer({ availability: a }).find((x) => x.message.includes('availability'));
      expect(f?.severity).toBe('info');
      expect(f?.message).toContain('ItemAvailability');
    }
  });
  it('accepts a valid itemCondition, flags an invalid one as info', () => {
    expect(offer({ itemCondition: 'NewCondition' })).toEqual([]);
    expect(offer({ itemCondition: 'new' }).find((x) => x.message.includes('itemCondition'))?.severity).toBe('info');
  });
  it('accepts a valid eventStatus, flags an invalid one as info', () => {
    expect(event({ eventStatus: 'EventScheduled' })).toEqual([]);
    expect(event({ eventStatus: 'cancelled' }).find((x) => x.message.includes('eventStatus'))?.severity).toBe('info');
  });
});

describe('structuredDataFindings — formats v2: cross-field checks', () => {
  const event = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Event', name: 'E', startDate: '2024-01-10', location: { '@type': 'Place', name: 'P' },
      endDate: '2024-01-11', image: 'https://x.com/i.jpg', description: 'd',
      offers: { price: '1', priceCurrency: 'EUR' }, eventStatus: 'EventScheduled', ...over,
    })], '/p');
  const product = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd', ...over,
    })], '/p');

  it('flags endDate before startDate (same precision)', () => {
    const w = event({ startDate: '2024-01-10', endDate: '2024-01-05' }).find((f) => f.severity === 'warning');
    expect(w?.message).toContain('endDate antérieure');
    expect(w?.after).toBe('2024-01-05');
  });
  it('accepts equal start and end dates', () => {
    expect(event({ startDate: '2024-01-10', endDate: '2024-01-10' }).some((f) => f.severity === 'warning')).toBe(false);
  });
  it('skips the comparison on mixed precision (date vs datetime)', () => {
    expect(event({ startDate: '2024-01-10', endDate: '2024-01-05T10:00:00Z' }).some((f) => f.severity === 'warning')).toBe(false);
  });
  it('skips the comparison on differing timezones', () => {
    expect(event({ startDate: '2024-01-10T10:00:00+02:00', endDate: '2024-01-05T10:00:00Z' }).some((f) => f.severity === 'warning')).toBe(false);
  });

  it('flags an inverted rating scale once (no ratingValue double-report)', () => {
    const warns = product({ aggregateRating: { ratingValue: 3, worstRating: 5, bestRating: 1, reviewCount: '10' } })
      .filter((f) => f.severity === 'warning');
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('bestRating');
  });
  it('accepts a custom scale where bestRating > worstRating', () => {
    expect(product({ aggregateRating: { ratingValue: 8, worstRating: 1, bestRating: 10, reviewCount: '10' } })
      .some((f) => f.severity === 'warning')).toBe(false);
  });
});

describe('structuredDataFindings — formats v2: priceValidUntil', () => {
  const offer = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd',
      offers: { price: '9', priceCurrency: 'EUR', availability: 'InStock', url: 'https://x.com/buy', ...over },
    })], '/p');

  it('flags a malformed priceValidUntil as a date warning', () => {
    const w = offer({ priceValidUntil: 'hier' }).find((f) => f.severity === 'warning');
    expect(w?.message).toContain('priceValidUntil');
    expect(w?.message).toContain('date');
  });
  it('accepts a valid priceValidUntil', () => {
    expect(offer({ priceValidUntil: '2024-12-31' })).toEqual([]);
  });
});

describe('structuredDataFindings — sub-types: AggregateOffer (byType)', () => {
  const product = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({ '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd', ...over })], '/p');

  it('validates an AggregateOffer via @type dispatch (no missing-price false positive)', () => {
    expect(product({ offers: { '@type': 'AggregateOffer', lowPrice: '10', priceCurrency: 'EUR' } })
      .some((f) => f.severity === 'warning')).toBe(false);
  });
  it('flags an AggregateOffer missing lowPrice under the AggregateOffer breadcrumb', () => {
    const w = product({ offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR' } }).find((f) => f.severity === 'warning');
    expect(w?.message).toContain('AggregateOffer');
    expect(w?.after).toContain('lowPrice');
  });
  it('still validates a typeless offers object as the default Offer', () => {
    const w = product({ offers: { price: '9' } }).find((f) => f.severity === 'warning');
    expect(w?.message).toContain('Offer');
    expect(w?.message).not.toContain('AggregateOffer');
    expect(w?.after).toContain('priceCurrency');
  });
});

describe('structuredDataFindings — sub-types: Review / Rating / Byline', () => {
  const product = (over: Record<string, unknown>) =>
    structuredDataFindings([ld({
      '@type': 'Product', name: 'X', image: 'i', brand: 'b', sku: 's', description: 'd',
      offers: { price: '9', priceCurrency: 'EUR', availability: 'InStock', url: 'https://x.com/buy' }, ...over,
    })], '/p');

  it('no warning for a complete review', () => {
    expect(product({ review: [{ author: { name: 'A' }, reviewRating: { ratingValue: 5 }, datePublished: '2024-01-01' }] })
      .some((f) => f.severity === 'warning')).toBe(false);
  });
  it('flags a review missing author', () => {
    const w = product({ review: [{ reviewRating: { ratingValue: 5 } }] }).find((f) => f.severity === 'warning');
    expect(w?.message).toContain('Review');
    expect(w?.after).toContain('author');
  });
  it('flags a Review › Rating out of range (depth 3)', () => {
    const w = product({ review: [{ author: { name: 'A' }, reviewRating: { ratingValue: 9 } }] })
      .find((f) => f.severity === 'warning' && f.message.includes('Rating'));
    expect(w?.message).toContain('Review › Rating');
  });
  it('flags a Review › Byline missing name', () => {
    const w = product({ review: [{ author: {}, reviewRating: { ratingValue: 5 } }] })
      .find((f) => f.severity === 'warning' && f.message.includes('Byline'));
    expect(w?.message).toContain('Review › Byline');
    expect(w?.after).toContain('name');
  });
});

describe('structuredDataFindings — sub-types: ImageObject', () => {
  it('accepts an ImageObject with a url', () => {
    expect(structuredDataFindings([ld({ ...ARTICLE_FULL, image: { '@type': 'ImageObject', url: 'https://x.com/i.jpg' } })], '/p')).toEqual([]);
  });
  it('flags an ImageObject without url/contentUrl', () => {
    const w = structuredDataFindings([ld({ ...ARTICLE_FULL, image: { '@type': 'ImageObject' } })], '/p')
      .find((f) => f.severity === 'warning' && f.message.includes('ImageObject'));
    expect(w?.after).toContain('url');
  });
  it('flags an Organization logo object without url', () => {
    const w = structuredDataFindings([ld({
      '@type': 'Organization', name: 'O', url: 'https://x.com', logo: {}, sameAs: 'https://x', contactPoint: {},
    })], '/p').find((f) => f.message.includes('ImageObject'));
    expect(w?.severity).toBe('warning');
  });
  it('skips a string author (no Byline finding)', () => {
    expect(structuredDataFindings([ld({ ...ARTICLE_FULL, author: 'Jane Doe' })], '/p').some((f) => f.message.includes('Byline'))).toBe(false);
  });
});

describe('structuredDataFindings — sub-types: VideoObject', () => {
  const VIDEO_FULL = {
    '@type': 'VideoObject', name: 'V', thumbnailUrl: 'https://x.com/t.jpg', uploadDate: '2024-01-01',
    contentUrl: 'https://x.com/v.mp4', description: 'd', duration: 'PT1M',
  };
  it('no findings for a complete VideoObject', () => {
    expect(structuredDataFindings([ld(VIDEO_FULL)], '/p')).toEqual([]);
  });
  it('flags a missing required uploadDate', () => {
    const { uploadDate, ...noDate } = VIDEO_FULL; void uploadDate;
    expect(structuredDataFindings([ld(noDate)], '/p').some((f) => f.severity === 'warning' && f.after?.includes('uploadDate'))).toBe(true);
  });
  it('flags missing both contentUrl and embedUrl as one anyOf warning', () => {
    const { contentUrl, ...noUrl } = VIDEO_FULL; void contentUrl;
    const warns = structuredDataFindings([ld(noUrl)], '/p').filter((f) => f.severity === 'warning');
    expect(warns).toHaveLength(1);
    expect(warns[0].after).toContain('contentUrl|embedUrl');
  });
  it('flags a bad thumbnailUrl as info and a bad duration as warning', () => {
    expect(structuredDataFindings([ld({ ...VIDEO_FULL, thumbnailUrl: 'x' })], '/p').find((f) => f.message.includes('thumbnailUrl'))?.severity).toBe('info');
    expect(structuredDataFindings([ld({ ...VIDEO_FULL, duration: '5 min' })], '/p').find((f) => f.message.includes('duration'))?.severity).toBe('warning');
  });
});
