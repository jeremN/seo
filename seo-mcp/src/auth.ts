export function parseAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Fail closed: an empty allowlist denies everyone.
export function isAllowed(login: string | undefined, allowlist: string[]): boolean {
  if (!login || allowlist.length === 0) return false;
  return allowlist.includes(login.toLowerCase());
}
