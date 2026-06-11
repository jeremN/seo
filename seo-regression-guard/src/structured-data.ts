import { mkFinding } from './maillage.js';
import type { Finding, SeoSignals } from './types.js';

interface TypeRule {
  required: string[];   // each must be a present, non-empty top-level prop
  anyOf?: string[];     // at least one must be present (a single "one-of" group)
  recommended: string[]; // present → good; missing → info
}

// Google-rich-result field requirements per canonical schema.org @type (top-level presence,
// v1 — nested-value depth is deferred). Add a type by adding a row; it's pure data.
const RULES: Record<string, TypeRule> = {
  Article: { required: ['headline'], recommended: ['image', 'datePublished', 'dateModified', 'author', 'publisher'] },
  Product: { required: ['name'], anyOf: ['offers', 'review', 'aggregateRating'], recommended: ['image', 'brand', 'sku', 'description'] },
  BreadcrumbList: { required: ['itemListElement'], recommended: [] },
  Organization: { required: ['name'], recommended: ['url', 'logo', 'sameAs', 'contactPoint'] },
  FAQPage: { required: ['mainEntity'], recommended: [] },
  Event: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'image', 'description', 'offers', 'eventStatus'] },
  Recipe: { required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'], recommended: ['author', 'datePublished', 'description', 'aggregateRating', 'nutrition'] },
  LocalBusiness: { required: ['name', 'address'], recommended: ['telephone', 'openingHoursSpecification', 'geo', 'priceRange', 'url', 'image'] },
};

// schema.org subtype → the canonical type whose rule applies. Anything absent maps to itself.
const ALIASES: Record<string, string> = {
  NewsArticle: 'Article', BlogPosting: 'Article',
  Restaurant: 'LocalBusiness', Store: 'LocalBusiness', Bakery: 'LocalBusiness',
  CafeOrCoffeeShop: 'LocalBusiness', FoodEstablishment: 'LocalBusiness',
};

const canonical = (type: string): string => ALIASES[type] ?? type;

// Present unless null/undefined, an empty/whitespace string, or an empty array.
function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// Audit-only JSON-LD completeness check: per recognised @type, missing required props (and an
// unmet anyOf group) → one warning; missing recommended props → one info. Reuses the
// `structured-data` signal. Identical findings (by message) are deduped across nodes.
export function structuredDataFindings(jsonLd: SeoSignals['jsonLd'], path: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const emit = (severity: 'warning' | 'info', after: string, message: string): void => {
    if (seen.has(message)) return;
    seen.add(message);
    out.push(mkFinding(path, 'structured-data', severity, null, after, message));
  };

  for (const entry of jsonLd) {
    if (!entry.valid || !entry.node) continue;
    const node = entry.node;
    const types = [...new Set(entry.types.map(canonical))];
    for (const type of types) {
      const rule = RULES[type];
      if (!rule) continue;
      const missingRequired = rule.required.filter((k) => !isPresent(node[k]));
      const anyOfUnmet = rule.anyOf !== undefined && !rule.anyOf.some((k) => isPresent(node[k]));
      const required = [...missingRequired, ...(anyOfUnmet ? [rule.anyOf!.join('|')] : [])];
      if (required.length) {
        const after = required.join(', ');
        emit('warning', after, `${type} : champs requis manquants — ${after}.`);
      }
      const missingRecommended = rule.recommended.filter((k) => !isPresent(node[k]));
      if (missingRecommended.length) {
        const after = missingRecommended.join(', ');
        emit('info', after, `${type} : champs recommandés manquants — ${after}.`);
      }
    }
  }
  return out;
}
