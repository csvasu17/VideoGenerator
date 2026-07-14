/**
 * treeLayout — hand-rolled recursive tree layout for the app_flow template.
 *
 * Computes a top-down (root at top, siblings spread left-to-right) sitemap
 * layout for a tree of screens, normalized to [0,1] fractions of a fixed
 * virtual canvas. Deliberately NOT using a graph-layout dependency
 * (dagre/d3-hierarchy/react-flow) — at this data scale (tens of nodes, depth
 * 2-4) a naive width-summing layout is exactly as good as a library's
 * contour-compaction algorithm, which only pays for itself at hundreds/
 * thousands of nodes.
 *
 * Pure function, no I/O — runs once in the automation pipeline and the
 * result is baked into demo-package.json. The Remotion composition never
 * runs layout math; it just reads x/y/width/height off each node.
 */

export interface TreeLayoutNode {
  id:        string;
  parentId?: string;
}

export interface TreeLayoutPosition {
  x:      number;   // center, fraction 0-1 of the virtual canvas width
  y:      number;   // center, fraction 0-1 of the virtual canvas height
  width:  number;   // fraction 0-1 of canvas width
  height: number;   // fraction 0-1 of canvas height
  depth:  number;
}

const ROOT_MARGIN     = 0.06;  // canvas margin on every side, as a fraction
const NODE_BOX_WIDTH  = 0.12;  // uniform node box width, fraction of canvas
const NODE_BOX_HEIGHT = 0.08;  // uniform node box height, fraction of canvas

/**
 * Lays out a forest (nodes may have multiple roots — orphans whose parentId
 * is absent or not present in the node set are each treated as their own
 * root) using a simplified Reingold-Tilford-style width-summing pass:
 *   - a leaf's subtree-width = 1 slot
 *   - an internal node's subtree-width = sum of its children's subtree-widths
 *   - a node's x = center of the slot range assigned to its subtree
 *   - a node's y = its depth row, evenly divided across the canvas height
 */
export function computeTreeLayout(nodes: TreeLayoutNode[]): Map<string, TreeLayoutPosition> {
  const result = new Map<string, TreeLayoutPosition>();
  if (nodes.length === 0) return result;

  const byId       = new Map(nodes.map(n => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];

  for (const n of nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
      childrenOf.get(n.parentId)!.push(n.id);
    } else {
      roots.push(n.id);
    }
  }

  // ── Pass 1: subtree width, in leaf-slot units ─────────────────────────────
  const subtreeWidth = new Map<string, number>();

  function computeWidth(id: string): number {
    const kids = childrenOf.get(id) ?? [];
    const width = kids.length === 0
      ? 1
      : kids.reduce((sum, k) => sum + computeWidth(k), 0);
    subtreeWidth.set(id, width);
    return width;
  }
  for (const r of roots) computeWidth(r);

  const totalWidth = roots.reduce((sum, r) => sum + (subtreeWidth.get(r) ?? 1), 0) || 1;

  // ── Pass 2: assign slot ranges (→ x center) and depth (→ y row) ───────────
  const depthOf     = new Map<string, number>();
  const slotCenter  = new Map<string, number>(); // in [0, totalWidth] slot units

  function assign(id: string, slotStart: number, depth: number): void {
    depthOf.set(id, depth);
    const width = subtreeWidth.get(id) ?? 1;
    slotCenter.set(id, slotStart + width / 2);

    let cursor = slotStart;
    for (const kid of childrenOf.get(id) ?? []) {
      const kidWidth = subtreeWidth.get(kid) ?? 1;
      assign(kid, cursor, depth + 1);
      cursor += kidWidth;
    }
  }

  let rootCursor = 0;
  for (const r of roots) {
    assign(r, rootCursor, 0);
    rootCursor += subtreeWidth.get(r) ?? 1;
  }

  // ── Pass 3: normalize to canvas fractions ─────────────────────────────────
  const maxDepth     = Math.max(0, ...Array.from(depthOf.values()));
  const usableWidth  = 1 - ROOT_MARGIN * 2;
  const usableHeight = 1 - ROOT_MARGIN * 2;
  const rowHeight    = usableHeight / (maxDepth + 1);

  for (const n of nodes) {
    const depth  = depthOf.get(n.id) ?? 0;
    const center = slotCenter.get(n.id) ?? totalWidth / 2;

    result.set(n.id, {
      x:      ROOT_MARGIN + (center / totalWidth) * usableWidth,
      y:      ROOT_MARGIN + depth * rowHeight + rowHeight / 2,
      width:  NODE_BOX_WIDTH,
      height: NODE_BOX_HEIGHT,
      depth,
    });
  }

  return result;
}
