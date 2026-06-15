/**
 * workflow-types.ts — Configurable workflow recording system.
 *
 * Each project defines an ordered list of WorkflowClips.
 * Each clip contains explicit navigation steps that guide Playwright
 * through a meaningful business flow, producing one recording per clip.
 *
 * This replaces random page crawling with intentional demo storytelling.
 */

// ─── Step types ───────────────────────────────────────────────────────────────

export type WorkflowStepType =
  | 'navigate'        // go to a URL
  | 'click'           // click an element (by selector or text)
  | 'tab_click'       // click a tab (searches in tab-like elements first)
  | 'wait'            // pause or wait for a selector to appear
  | 'scroll'          // scroll the page
  | 'hover'           // hover to reveal tooltips / dropdowns
  | 'fill'            // type into an input
  | 'key'             // press a keyboard key (Escape, Enter, Tab, …)
  | 'back'            // browser back navigation
  | 'suppress';       // close any popups/overlays

export interface WorkflowStep {
  type:        WorkflowStepType;
  description?: string;     // optional human-readable note (not executed)

  // ── navigate ──
  url?:        string;      // relative ('/dashboard') or absolute URL

  // ── click / tab_click / hover ──
  selector?:   string;      // CSS selector
  text?:       string;      // match element by visible text content
  index?:      number;      // nth matching element (0-based, default 0)
  optional?:   boolean;     // skip silently if element not found
  waitAfter?:  number;      // ms to wait after the action (default varies by type)

  // ── wait ──
  ms?:         number;      // waitForTimeout
  waitFor?:    string;      // waitForSelector (CSS)
  timeout?:    number;      // selector timeout (ms)

  // ── scroll ──
  y?:          number;      // scroll to absolute Y position
  by?:         number;      // scroll by N pixels (relative)

  // ── fill ──
  value?:      string;

  // ── key ──
  key?:        string;      // e.g. 'Escape', 'Enter', 'Tab', 'ArrowDown'
}

// ─── Clip definition ──────────────────────────────────────────────────────────

export interface WorkflowClip {
  id:        string;          // output filename (no extension)
  title:     string;          // title card shown in the video
  subtitle?: string;          // subtitle shown under the title card
  accent?:   'blue' | 'orange';
  steps:     WorkflowStep[];  // ordered navigation actions
  holdMs?:   number;          // ms to hold final screen before ending (default 2500)
  /**
   * Run the MVID InteractionDetector after the explicit workflow steps.
   *
   * When true, the recorder automatically discovers and clicks all remaining
   * tabs, accordions, and visual controls that the explicit steps haven't
   * already activated — without any hardcoded selectors.
   *
   * Default: false (existing clips are unchanged unless opted in).
   */
  interactionDiscovery?: boolean;
}

// ─── Project workflow config ──────────────────────────────────────────────────

export interface ProjectWorkflows {
  projectId:   string;
  appUrl:      string;        // base URL of the application
  credentials?: {
    username:            string;
    password:            string;
    usernameSelector?:   string;  // override if auto-detection fails
    passwordSelector?:   string;
    submitSelector?:     string;
    successIndicator?:   string;  // selector present after successful login
  };
  clips: WorkflowClip[];      // ORDERED list — defines the video sequence
}
