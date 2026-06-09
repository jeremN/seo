/**
 * Linear glob matcher — supports only `*` as a wildcard (matches any sequence
 * of characters). Uses no RegExp so it is immune to ReDoS.
 */
export function matchGlob(glob: string, str: string): boolean {
  const parts = glob.split('*');
  if (parts.length === 1) return glob === str;
  if (!str.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (i === parts.length - 1) {
      // Last segment must match the tail of str exactly.
      return str.endsWith(seg) && pos <= str.length - seg.length;
    }
    const idx = str.indexOf(seg, pos);
    if (idx === -1) return false;
    pos = idx + seg.length;
  }
  return true;
}

export function isIgnored(path: string, globs: string[]): boolean {
  return globs.some((g) => matchGlob(g, path));
}
