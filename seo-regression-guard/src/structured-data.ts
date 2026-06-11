import { mkFinding } from './maillage.js';
import type { Finding, SeoSignals } from './types.js';

interface TypeRule {
  required?: string[];     // each must be a present, non-empty top-level prop
  anyOf?: string[];        // at least one must be present (a single "one-of" group)
  recommended?: string[];  // present → good; missing → info
  nested?: NestedRule[];   // object-valued fields to recurse into
}

interface NestedRule {
  field: string;   // the property holding the nested object(s)
  as: string;      // sub-type name, for the breadcrumb message (e.g. 'Offer')
  rule: TypeRule;  // the sub-rule (may itself have `nested` → arbitrary depth)
  array?: boolean; // the field is a collection of objects → validate each element
}

// --- nested sub-type rules (declared before the parent rules that reference them) ---
const Answer: TypeRule = { required: ['text'] };
const Question: TypeRule = { required: ['name', 'acceptedAnswer'], nested: [{ field: 'acceptedAnswer', as: 'Answer', rule: Answer }] };
const Offer: TypeRule = { required: ['price', 'priceCurrency'], recommended: ['availability', 'url'] };
const AggregateRating: TypeRule = { required: ['ratingValue'], anyOf: ['reviewCount', 'ratingCount'] };
const ListItem: TypeRule = { required: ['name', 'item', 'position'] };
const PostalAddress: TypeRule = { required: ['streetAddress', 'addressLocality', 'addressCountry'], recommended: ['addressRegion', 'postalCode'] };
const GeoCoordinates: TypeRule = { required: ['latitude', 'longitude'] };

// Google-rich-result field requirements per canonical schema.org @type. Top-level presence plus
// `nested` recursion into object-valued props (v1 curated sub-types). Pure data — add a row to
// extend.
const RULES: Record<string, TypeRule> = {
  Article: { required: ['headline'], recommended: ['image', 'datePublished', 'dateModified', 'author', 'publisher'] },
  Product: {
    required: ['name'], anyOf: ['offers', 'review', 'aggregateRating'], recommended: ['image', 'brand', 'sku', 'description'],
    nested: [{ field: 'offers', as: 'Offer', rule: Offer }, { field: 'aggregateRating', as: 'AggregateRating', rule: AggregateRating }],
  },
  BreadcrumbList: { required: ['itemListElement'], nested: [{ field: 'itemListElement', as: 'ListItem', rule: ListItem, array: true }] },
  Organization: { required: ['name'], recommended: ['url', 'logo', 'sameAs', 'contactPoint'] },
  FAQPage: { required: ['mainEntity'], nested: [{ field: 'mainEntity', as: 'Question', rule: Question, array: true }] },
  Event: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'image', 'description', 'offers', 'eventStatus'] },
  Recipe: {
    required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
    recommended: ['author', 'datePublished', 'description', 'aggregateRating', 'nutrition'],
    nested: [{ field: 'aggregateRating', as: 'AggregateRating', rule: AggregateRating }],
  },
  LocalBusiness: {
    required: ['name', 'address'], recommended: ['telephone', 'openingHoursSpecification', 'geo', 'priceRange', 'url', 'image'],
    nested: [
      { field: 'address', as: 'PostalAddress', rule: PostalAddress },
      { field: 'geo', as: 'GeoCoordinates', rule: GeoCoordinates },
      { field: 'aggregateRating', as: 'AggregateRating', rule: AggregateRating },
    ],
  },
};

// schema.org subtype → the canonical type whose rule applies. Anything absent maps to itself.
const ALIASES: Record<string, string> = {
  NewsArticle: 'Article', BlogPosting: 'Article',
  Restaurant: 'LocalBusiness', Store: 'LocalBusiness', Bakery: 'LocalBusiness',
  CafeOrCoffeeShop: 'LocalBusiness', FoodEstablishment: 'LocalBusiness',
};

const canonical = (type: string): string => ALIASES[type] ?? type;

// Present unless null/undefined, an empty/whitespace string, or an empty array. Numbers (incl. 0)
// and objects (incl. {}) count as present — so a 0 latitude is fine and an empty `offers: {}`
// passes the top-level check but is then caught by the nested recursion.
function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type Emit = (severity: 'warning' | 'info', after: string, message: string) => void;

// Check one node against a rule, emitting at most one warning (missing required + unmet anyOf) and
// one info (missing recommended); then recurse into present object-valued `nested` fields. The
// `prefix` builds the breadcrumb shown in the message ('Product', then 'Product › Offer').
function collect(node: Record<string, unknown>, prefix: string, rule: TypeRule, emit: Emit): void {
  const missingRequired = (rule.required ?? []).filter((k) => !isPresent(node[k]));
  const anyOfUnmet = rule.anyOf !== undefined && !rule.anyOf.some((k) => isPresent(node[k]));
  const required = [...missingRequired, ...(anyOfUnmet ? [rule.anyOf!.join('|')] : [])];
  if (required.length) {
    const after = required.join(', ');
    emit('warning', after, `${prefix} : champs requis manquants — ${after}.`);
  }
  const missingRecommended = (rule.recommended ?? []).filter((k) => !isPresent(node[k]));
  if (missingRecommended.length) {
    const after = missingRecommended.join(', ');
    emit('info', after, `${prefix} : champs recommandés manquants — ${after}.`);
  }
  for (const n of rule.nested ?? []) {
    const v = node[n.field];
    if (!isPresent(v)) continue; // absent → already flagged by the parent's required/anyOf
    const children = n.array && Array.isArray(v) ? v : [v];
    for (const child of children) {
      if (isObject(child)) collect(child, `${prefix} › ${n.as}`, n.rule, emit);
    }
  }
}

// Audit-only JSON-LD completeness check: per recognised @type (and nested sub-types), missing
// required props → warning, missing recommended → info. Reuses the `structured-data` signal.
// Identical findings (by message) are deduped across nodes and array elements.
export function structuredDataFindings(jsonLd: SeoSignals['jsonLd'], path: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const emit: Emit = (severity, after, message) => {
    if (seen.has(message)) return;
    seen.add(message);
    out.push(mkFinding(path, 'structured-data', severity, null, after, message));
  };

  for (const entry of jsonLd) {
    if (!entry.valid || !entry.node) continue;
    for (const type of new Set(entry.types.map(canonical))) {
      const rule = RULES[type];
      if (rule) collect(entry.node, type, rule, emit);
    }
  }
  return out;
}
