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
