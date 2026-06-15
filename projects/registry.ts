// Project registry — add new projects here.
// Usage: getProject('rheem') returns the composition + config for that project.

import type {ProjectConfig} from '../core/types';

export interface ProjectEntry {
  config:      ProjectConfig;
  Composition: React.ComponentType;
}

// Lazy loaders — avoids bundling all projects at once
export const PROJECT_IDS = ['rheem'] as const;
export type ProjectId = typeof PROJECT_IDS[number];

export function isValidProject(id: string): id is ProjectId {
  return PROJECT_IDS.includes(id as ProjectId);
}
