/** Clamp a value to [min, max]. */
export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Keyword bonus using a linear-capped approach.
 * 1 hit → 1/3 of maxBonus, 2 hits → 2/3, 3+ hits → full maxBonus.
 */
export function keywordBonus(
  text: string,
  keywords: readonly string[],
  maxBonus: number,
): number {
  const lower = text.toLowerCase();
  const hits = keywords.filter(kw => lower.includes(kw)).length;
  return Math.round(clamp((hits / 3) * maxBonus, 0, maxBonus));
}

/**
 * Logarithmic scale for a count value.
 * count=1 → ~29% of maxScore, count=3 → ~53%, count=7 → ~77%, count=10+ → maxScore.
 */
export function logScore(count: number, maxScore: number): number {
  if (count <= 0) return 0;
  return clamp(Math.round((Math.log2(count + 1) / Math.log2(11)) * maxScore), 0, maxScore);
}

/**
 * Linear score for a count capped at a saturation value.
 * e.g. linearScore(30, 50, 25) = 15  (30/50 * 25)
 */
export function linearScore(count: number, saturatesAt: number, maxScore: number): number {
  return clamp(Math.round((count / saturatesAt) * maxScore), 0, maxScore);
}
