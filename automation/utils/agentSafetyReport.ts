/**
 * agentSafetyReport.ts — non-blocking report for exhaustive Agent Recording,
 * mirroring automation/utils/demoValidation.ts's ValidationReport pattern and
 * philosophy: informational only, never blocks the pipeline, exists so a human
 * can review what was (and wasn't) exercised after the fact.
 */

import type { SkipRecord } from './agentInteractionLoop';
import type { RoleMatchConfidence } from './session';

export interface RoleFootageNote {
  role:             string;
  quickAccessMatch: RoleMatchConfidence | 'login-failed';
  detail:           string;
}

export interface AgentRunReport {
  generatedAt:             string;
  appUrl:                  string;
  rolesRun:                string[];
  roleFootageNotes:        RoleFootageNote[];
  pagesVisited:            number;
  totalElementsEnumerated: number;
  totalClicked:            number;
  totalFilled:             number;
  totalSkipped:            number;
  skipped:                 SkipRecord[];
  passed:                  true; // always true — informational only, never blocks the pipeline
}

export function buildAgentRunReport(input: {
  appUrl: string;
  rolesRun: string[];
  roleFootageNotes: RoleFootageNote[];
  pageResults: { elementsFound: number; clicked: number; filled: number; skipped: SkipRecord[] }[];
}): AgentRunReport {
  const skipped = input.pageResults.flatMap(p => p.skipped);
  return {
    generatedAt:             new Date().toISOString(),
    appUrl:                  input.appUrl,
    rolesRun:                input.rolesRun,
    roleFootageNotes:        input.roleFootageNotes,
    pagesVisited:            input.pageResults.length,
    totalElementsEnumerated: input.pageResults.reduce((s, p) => s + p.elementsFound, 0),
    totalClicked:            input.pageResults.reduce((s, p) => s + p.clicked, 0),
    totalFilled:             input.pageResults.reduce((s, p) => s + p.filled, 0),
    totalSkipped:            skipped.length,
    skipped,
    passed:                  true,
  };
}

export function printAgentSafetyReport(report: AgentRunReport): void {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  🛡️   AGENT RECORDING — SAFETY REPORT');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Roles run       : ${report.rolesRun.join(', ') || '(none)'}`);
  for (const note of report.roleFootageNotes) {
    const flag = note.quickAccessMatch === 'matched' ? '✓' : '⚠';
    console.log(`    ${flag} ${note.role}: ${note.quickAccessMatch} — ${note.detail}`);
  }
  console.log(`  Pages visited   : ${report.pagesVisited}`);
  console.log(`  Elements found  : ${report.totalElementsEnumerated}`);
  console.log(`  Clicked         : ${report.totalClicked}`);
  console.log(`  Filled          : ${report.totalFilled}`);
  console.log(`  Skipped (risky) : ${report.totalSkipped}`);
  if (report.totalSkipped > 0) {
    console.log(`\n  First ${Math.min(20, report.skipped.length)} skipped elements:`);
    for (const s of report.skipped.slice(0, 20)) {
      console.log(`    [${s.role}] ${s.pageId} — "${(s.text || s.ariaLabel || '(no text)').slice(0, 50)}" — ${s.reason}`);
    }
    if (report.skipped.length > 20) console.log(`    … and ${report.skipped.length - 20} more (see agent-safety-report.json)`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');
}
