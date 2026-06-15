import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { ApplicationGraph } from './types';

export interface ExportOptions {
  outputPath: string;
  pretty?: boolean;
}

export class GraphExporter {
  /**
   * Serialize graph to a JSON string.
   */
  toJSON(graph: ApplicationGraph, pretty = true): string {
    return JSON.stringify(graph, null, pretty ? 2 : 0);
  }

  /**
   * Write graph JSON to disk, creating intermediate directories as needed.
   * Returns the resolved output path.
   */
  async toFile(graph: ApplicationGraph, options: ExportOptions): Promise<string> {
    const { outputPath, pretty = true } = options;
    const json = this.toJSON(graph, pretty);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, 'utf-8');
    return outputPath;
  }

  /**
   * Read and deserialize a graph from a JSON file.
   */
  async fromFile(filePath: string): Promise<ApplicationGraph> {
    const raw = await readFile(filePath, 'utf-8');
    return this.fromJSON(raw);
  }

  /**
   * Deserialize and validate a graph from a JSON string.
   */
  fromJSON(json: string): ApplicationGraph {
    const parsed: unknown = JSON.parse(json);
    assertValidGraph(parsed);
    return parsed;
  }
}

function assertValidGraph(value: unknown): asserts value is ApplicationGraph {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray((value as ApplicationGraph).nodes) ||
    !Array.isArray((value as ApplicationGraph).edges) ||
    typeof (value as ApplicationGraph).meta !== 'object'
  ) {
    throw new TypeError(
      'Invalid ApplicationGraph: must have nodes[], edges[], and meta object',
    );
  }
}
