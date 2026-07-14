/**
 * Extracts the first-listed role name from an APP_ROUTE_MAP label, e.g.
 * "Surgeon / Program Director / OR Coordinator / Admin — Interactive..."
 * → "Surgeon". Returns null if the label has no "role list — description" shape.
 */
export function extractPrimaryRole(label: string): string | null {
  const dashIdx = label.indexOf('—');
  const rolePart = dashIdx === -1 ? null : label.slice(0, dashIdx).trim();
  if (!rolePart) return null;
  return rolePart.split('/')[0]?.trim() || null;
}

/**
 * Extracts EVERY role listed in an APP_ROUTE_MAP label (not just the first), e.g.
 * "Surgeon / Program Director / OR Coordinator / Admin — ..." →
 * ["Surgeon", "Program Director", "OR Coordinator", "Admin"].
 */
export function extractAllRoles(label: string): string[] {
  const dashIdx = label.indexOf('—');
  const rolePart = dashIdx === -1 ? null : label.slice(0, dashIdx).trim();
  if (!rolePart) return [];
  return rolePart.split('/').map(r => r.trim()).filter(Boolean);
}

/**
 * Collects the full set of distinct roles mentioned across every APP_ROUTE_MAP entry —
 * used by exhaustive Agent Recording to loop over every configured role automatically,
 * rather than just each route's first-listed (primary) role.
 */
export function discoverAllRoles(routeMap: Record<string, string>): string[] {
  const seen = new Set<string>();
  for (const label of Object.values(routeMap)) {
    for (const role of extractAllRoles(label)) seen.add(role);
  }
  return [...seen];
}
