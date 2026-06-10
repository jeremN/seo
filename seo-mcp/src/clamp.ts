export const MAX_PAGES_HARD_CAP = 200;
export const MAX_PAGES_DEFAULT = 50;

export function clampMaxPages(n: number | undefined): number {
  if (n == null || !Number.isFinite(n) || n <= 0) return MAX_PAGES_DEFAULT;
  return Math.min(Math.floor(n), MAX_PAGES_HARD_CAP);
}
