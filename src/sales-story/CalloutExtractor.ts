/**
 * CalloutExtractor — deterministic 3-6 word benefit headline generator.
 *
 * Priority:
 *   1. Known template table (matched by featureName keywords)
 *   2. Heuristic extraction from businessBenefit text
 *   3. Fallback: first 5 words of businessBenefit
 */

// Known template table — match featureName first
const CALLOUT_TEMPLATES: Array<[RegExp, string]> = [
  [/\b(predict|predictive|ai.predict)\b/i, 'Prevent Failures Before They Happen'],
  [/\b(alarm|alert|incident)\b/i,          'Respond Faster To Critical Issues'],
  [/\b(energy|consumption|utility)\b/i,    'Cut Costs With Live Energy Data'],
  [/\b(device|fleet|health|connectivity)\b/i, 'Monitor Every Device In Real Time'],
  [/\bsimulat/i,                           'Test Every Scenario. Zero Risk.'],
  [/\b(building|site|onboard)\b/i,         'Add New Sites In Minutes'],
  [/\b(user|role|permission|access)\b/i,   'Control Access From One Screen'],
  [/\b(dashboard|overview|kpi|metric)\b/i, 'See Everything. Act Faster.'],
  [/\bfault\b/i,                           'Test Every Scenario. Zero Risk.'],
  [/\bfleet\b/i,                           'Monitor Every Device In Real Time'],
];

const ACTION_VERBS = [
  'Prevent', 'Reduce', 'Monitor', 'Act', 'See', 'Test', 'Respond', 'Control',
  'Cut', 'Add', 'Build', 'Save', 'Protect', 'Predict', 'Detect', 'Track',
  'Optimize', 'Scale', 'Validate', 'Enable', 'Eliminate', 'Accelerate', 'Streamline',
];

const KNOWN_PAGE_TITLES = [
  'Dashboard', 'Alarm Center', 'Device Fleet', 'User Management',
  'Platform Settings', 'Sites', 'Users', 'Settings', 'Simulator', 'Insights',
];

/**
 * Extracts a 3-6 word benefit-driven callout headline.
 *
 * Priority:
 *   1. Template match against featureName
 *   2. Heuristic extraction from businessBenefit (action verb first clause)
 *   3. Template match against businessBenefit
 *   4. Fallback: first 5 words of businessBenefit
 */
export function extractCallout(featureName: string, businessBenefit: string): string {
  // 1. Template match against featureName
  for (const [regex, template] of CALLOUT_TEMPLATES) {
    if (regex.test(featureName)) {
      return template;
    }
  }

  // 2. Heuristic extraction from businessBenefit (starts with action verb)
  const firstWord = businessBenefit.trimStart().split(/\s+/)[0] ?? '';
  if (ACTION_VERBS.some(v => v.toLowerCase() === firstWord.toLowerCase())) {
    // Extract first clause up to separator characters
    const clauseMatch = businessBenefit.match(/^([^,\.—\-]{1,80})/);
    if (clauseMatch) {
      const clause = clauseMatch[1].trim();
      const words = clause.split(/\s+/);
      if (words.length >= 3) {
        return words.slice(0, 6).join(' ');
      }
    }
  }

  // 3. Template match against businessBenefit
  for (const [regex, template] of CALLOUT_TEMPLATES) {
    if (regex.test(businessBenefit)) {
      return template;
    }
  }

  // 4. Fallback: first 5 words of businessBenefit
  const fallbackWords = businessBenefit.trim().split(/\s+/).filter(w => w.length > 0);
  if (fallbackWords.length > 0) {
    return fallbackWords.slice(0, 5).join(' ');
  }

  return featureName;
}

/**
 * Returns true if the callout is benefit-driven:
 *   - Contains at least one action verb
 *   - Length 3-8 words
 *   - Is not a known UI page title
 */
export function isBenefitDriven(callout: string): boolean {
  const trimmed = callout.trim();

  // Must not be a known page title
  if (KNOWN_PAGE_TITLES.includes(trimmed)) {
    return false;
  }

  // Must be 3-8 words
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 3 || words.length > 8) {
    return false;
  }

  // Must contain at least one action verb (case-insensitive)
  const lowerCallout = trimmed.toLowerCase();
  return ACTION_VERBS.some(v => lowerCallout.includes(v.toLowerCase()));
}

// Named export for barrel re-export compatibility
export const CalloutExtractor = { extractCallout, isBenefitDriven };
