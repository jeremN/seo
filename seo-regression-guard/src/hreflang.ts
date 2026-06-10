// Shape validation for an hreflang value: `x-default`, or a BCP-47-ish
// language[-script][-region] tag (ISO 639 language, optional 4-letter script,
// optional 2-letter region). Case-insensitive. No bundled ISO code lists — this
// catches the real-world errors (underscores, full words, 3-letter regions, bad
// separators) but accepts well-formed-but-unregistered codes like `zz`.
const TAG_RE = /^[a-z]{2,3}(-[a-z]{4})?(-[a-z]{2})?$/i;

export function isValidHreflang(lang: string): boolean {
  const v = lang.trim();
  return v.toLowerCase() === 'x-default' || TAG_RE.test(v);
}
