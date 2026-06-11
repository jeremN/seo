import { mkFinding } from './maillage.js';
import type { Finding, SeoSignals } from './types.js';

interface TypeRule {
  required?: string[];     // each must be a present, non-empty top-level prop
  anyOf?: string[];        // at least one must be present (a single "one-of" group)
  recommended?: string[];  // present → good; missing → info
  nested?: NestedRule[];   // object-valued fields to recurse into
  formats?: Record<string, FormatKind>; // present-value shape checks (price→number, etc.)
}

// Shape categories for present-value validation. Deterministic and data-free (consistent with the
// hreflang shape-only philosophy): no bundled ISO-4217/639 lists, no lenient Date.parse.
type FormatKind = 'number' | 'currency' | 'date' | 'rating' | 'url';

interface NestedRule {
  field: string;   // the property holding the nested object(s)
  as: string;      // sub-type name, for the breadcrumb message (e.g. 'Offer')
  rule: TypeRule;  // the sub-rule (may itself have `nested` → arbitrary depth)
  array?: boolean; // the field is a collection of objects → validate each element
}

// --- nested sub-type rules (declared before the parent rules that reference them) ---
const Answer: TypeRule = { required: ['text'] };
const Question: TypeRule = { required: ['name', 'acceptedAnswer'], nested: [{ field: 'acceptedAnswer', as: 'Answer', rule: Answer }] };
const Offer: TypeRule = { required: ['price', 'priceCurrency'], recommended: ['availability', 'url'], formats: { price: 'number', priceCurrency: 'currency', url: 'url' } };
const AggregateRating: TypeRule = { required: ['ratingValue'], anyOf: ['reviewCount', 'ratingCount'], formats: { ratingValue: 'rating', reviewCount: 'number', ratingCount: 'number' } };
const ListItem: TypeRule = { required: ['name', 'item', 'position'], formats: { position: 'number', item: 'url' } };
const PostalAddress: TypeRule = { required: ['streetAddress', 'addressLocality', 'addressCountry'], recommended: ['addressRegion', 'postalCode'] };
const GeoCoordinates: TypeRule = { required: ['latitude', 'longitude'], formats: { latitude: 'number', longitude: 'number' } };

// Google-rich-result field requirements per canonical schema.org @type. Top-level presence plus
// `nested` recursion into object-valued props (v1 curated sub-types). Pure data — add a row to
// extend.
const RULES: Record<string, TypeRule> = {
  Article: { required: ['headline'], recommended: ['image', 'datePublished', 'dateModified', 'author', 'publisher'], formats: { datePublished: 'date', dateModified: 'date', image: 'url' } },
  Product: {
    required: ['name'], anyOf: ['offers', 'review', 'aggregateRating'], recommended: ['image', 'brand', 'sku', 'description'],
    nested: [{ field: 'offers', as: 'Offer', rule: Offer }, { field: 'aggregateRating', as: 'AggregateRating', rule: AggregateRating }],
  },
  BreadcrumbList: { required: ['itemListElement'], nested: [{ field: 'itemListElement', as: 'ListItem', rule: ListItem, array: true }] },
  Organization: { required: ['name'], recommended: ['url', 'logo', 'sameAs', 'contactPoint'], formats: { url: 'url', logo: 'url', sameAs: 'url' } },
  FAQPage: { required: ['mainEntity'], nested: [{ field: 'mainEntity', as: 'Question', rule: Question, array: true }] },
  Event: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'image', 'description', 'offers', 'eventStatus'], formats: { startDate: 'date', endDate: 'date' } },
  Recipe: {
    required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
    recommended: ['author', 'datePublished', 'description', 'aggregateRating', 'nutrition'],
    nested: [{ field: 'aggregateRating', as: 'AggregateRating', rule: AggregateRating }],
    formats: { datePublished: 'date', image: 'url' },
  },
  LocalBusiness: {
    required: ['name', 'address'], recommended: ['telephone', 'openingHoursSpecification', 'geo', 'priceRange', 'url', 'image'],
    formats: { url: 'url', image: 'url' },
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

// A finite JS number, or a non-empty numeric string ("9.99" ✓, "free"/"" ✗).
const isFiniteNum = (v: unknown): boolean =>
  typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));

// ISO-8601 date or datetime with real month/day ranges (no Date.parse). "2024-01-15",
// "2024-01-15T10:30:00Z", "…+01:00" ✓; "2024/01/15", "2024-13-40" ✗.
const ISO_8601 = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

// Absolute http(s) URL (string-valued only). Uses the WHATWG parser, so a relative "/x" — which has
// no base — throws and fails.
const isAbsoluteHttpUrl = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  try {
    const proto = new URL(v).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
};

type FormatCheck = (v: unknown, node: Record<string, unknown>) => boolean;

const FORMAT_CHECKS: Record<FormatKind, FormatCheck> = {
  number: (v) => isFiniteNum(v),
  currency: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v.trim()),
  date: (v) => typeof v === 'string' && ISO_8601.test(v.trim()),
  rating: (v, node) => {
    const n = Number(v);
    const lo = Number.isFinite(Number(node.worstRating)) ? Number(node.worstRating) : 1;
    const hi = Number.isFinite(Number(node.bestRating)) ? Number(node.bestRating) : 5;
    return Number.isFinite(n) && n >= lo && n <= hi;
  },
  // String → absolute http(s); array → every element; plain object → pass (it's a nested node, e.g.
  // an ImageObject, not a URL string).
  url: (v) => (Array.isArray(v) ? v.every((e) => FORMAT_CHECKS.url(e, {})) : isObject(v) ? true : isAbsoluteHttpUrl(v)),
};

const LABEL: Record<FormatKind, string> = {
  number: 'un nombre',
  currency: 'un code ISO-4217 (3 lettres majuscules)',
  date: 'une date ISO-8601',
  rating: "une note dans l'échelle (worst–best, défaut 1–5)",
  url: 'une URL http(s) absolue',
};

type Emit = (severity: 'warning' | 'info', after: string, message: string) => void;

// Check one node against a rule: one warning (missing required + unmet anyOf), one info (missing
// recommended), then a format finding per malformed present value (`formats`), then recurse into
// present object-valued `nested` fields. The `prefix` builds the breadcrumb shown in the message
// ('Product', then 'Product › Offer').
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
  // Format pass: only present values are checked, so a field yields a presence finding (absent) OR a
  // format finding (present-but-malformed), never both. `url` → info; everything else → warning.
  for (const [field, kind] of Object.entries(rule.formats ?? {})) {
    const v = node[field];
    if (!isPresent(v) || FORMAT_CHECKS[kind](v, node)) continue;
    emit(kind === 'url' ? 'info' : 'warning', String(v).slice(0, 50), `${prefix}.${field} : valeur invalide — attendu ${LABEL[kind]}.`);
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
