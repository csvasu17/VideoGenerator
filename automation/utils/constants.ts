/**
 * Fallback narration strings emitted by AI-content generators when a real
 * (vision or text) generation call fails or returns unusable content.
 * Shared so validation can flag scenes that silently fell back to these.
 */
export const GENERIC_NARRATIONS: ReadonlySet<string> = new Set([
  'This feature accelerates your workflow.',
  'This feature improves operational efficiency across your team.',
  'Platform Feature',
]);
