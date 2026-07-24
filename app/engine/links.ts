// Nearest-neighbour link building for the constellation style. Pure — no DOM,
// no engine state — so it unit-tests headlessly and bundles into the embed.
//
// Uniform grid with cell size = reach: any neighbour within reach of a dot is
// in its own or an adjacent cell, so each dot inspects at most 9 cells.
//
// All scratch lives in LinkBuffers so a 60fps caller allocates nothing per
// frame: arrays are reused (grown on demand), the dedupe Set is cleared.

const MAX_PER_DOT = 5;

export type LinkBuffers = {
  /** Flattened pairs [a0,b0, a1,b1, ...] with a < b. */
  pairs: Int32Array;
  /** Centre-to-centre distance of each pair (same index). */
  dists: Float32Array;
  /** Valid pair count. */
  m: number;
  /** Capacity (pairs). */
  cap: number;
  /** Scratch: cell counts, then start offsets (counting sort). */
  counts: Int32Array;
  /** Scratch: per-cell write cursors for the counting sort. */
  cursor: Int32Array;
  /** Scratch: dot indices sorted by cell. */
  order: Int32Array;
  /** Scratch: k-nearest candidates for the current dot. */
  nbr: Int32Array;
  /** Scratch: squared distances of nbr, ascending. */
  nbrD: Float32Array;
  /** Scratch: emitted pair keys, for a<b dedupe. */
  seen: Set<number>;
};

export function makeLinkBuffers(cap: number): LinkBuffers {
  return {
    pairs: new Int32Array(cap * 2),
    dists: new Float32Array(cap),
    m: 0,
    cap,
    counts: new Int32Array(0),
    cursor: new Int32Array(0),
    order: new Int32Array(0),
    nbr: new Int32Array(MAX_PER_DOT),
    nbrD: new Float32Array(MAX_PER_DOT),
    seen: new Set<number>(),
  };
}

/**
 * Fill `out` with up to `perDot` links per dot between dots closer than
 * `reach` (same units/space as `x`/`y`). `perDot` is silently clamped to 5
 * so a hand-written embed config can't blow up the per-frame cost.
 */
export function buildLinks(
  x: Float32Array,
  y: Float32Array,
  n: number,
  reach: number,
  perDot: number,
  out: LinkBuffers,
): void {
  out.m = 0;
  if (n < 2 || reach <= 0 || perDot < 1) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  const gw = Math.max(1, Math.min(256, Math.ceil((maxX - minX) / reach)));
  const gh = Math.max(1, Math.min(256, Math.ceil((maxY - minY) / reach)));
  const cellX = (i: number) => Math.min(gw - 1, ((x[i] - minX) / reach) | 0);
  const cellY = (i: number) => Math.min(gh - 1, ((y[i] - minY) / reach) | 0);

  // Counting sort of dots into cells: counts doubles as start offsets.
  // Scratch comes from `out` — grown only when the grid or dot count does.
  const cells = gw * gh;
  if (out.counts.length < cells + 1) out.counts = new Int32Array(cells + 1);
  else out.counts.fill(0, 0, cells + 1);
  if (out.cursor.length < cells) out.cursor = new Int32Array(cells);
  if (out.order.length < n) out.order = new Int32Array(n);
  const counts = out.counts;
  const cursor = out.cursor;
  const order = out.order;
  for (let i = 0; i < n; i++) counts[cellY(i) * gw + cellX(i) + 1]++;
  for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
  for (let c = 0; c < cells; c++) cursor[c] = counts[c];
  for (let i = 0; i < n; i++) order[cursor[cellY(i) * gw + cellX(i)]++] = i;

  const reachSq = reach * reach;
  const k = Math.min(MAX_PER_DOT, perDot | 0);
  const nbr = out.nbr; // k-nearest candidates
  const nbrD = out.nbrD; // squared distances, ascending
  const seen = out.seen;
  seen.clear();

  for (let i = 0; i < n && out.m < out.cap; i++) {
    let found = 0;
    const cx = cellX(i);
    const cy = cellY(i);
    for (let oy = -1; oy <= 1; oy++) {
      const yy = cy + oy;
      if (yy < 0 || yy >= gh) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox;
        if (xx < 0 || xx >= gw) continue;
        const c = yy * gw + xx;
        for (let s = counts[c]; s < counts[c + 1]; s++) {
          const j = order[s];
          if (j === i) continue;
          const dx = x[j] - x[i];
          const dy = y[j] - y[i];
          const dSq = dx * dx + dy * dy;
          if (dSq > reachSq) continue;
          // keep the k nearest via insertion (k ≤ 5)
          let p: number;
          if (found < k) p = found++;
          else if (dSq < nbrD[k - 1]) p = k - 1;
          else continue;
          nbr[p] = j;
          nbrD[p] = dSq;
          while (p > 0 && nbrD[p] < nbrD[p - 1]) {
            const tj = nbr[p];
            const td = nbrD[p];
            nbr[p] = nbr[p - 1];
            nbrD[p] = nbrD[p - 1];
            nbr[p - 1] = tj;
            nbrD[p - 1] = td;
            p--;
          }
        }
      }
    }
    for (let q = 0; q < found && out.m < out.cap; q++) {
      const j = nbr[q];
      const a = i < j ? i : j;
      const b = i < j ? j : i;
      const key = a * n + b;
      if (seen.has(key)) continue;
      seen.add(key);
      out.pairs[out.m * 2] = a;
      out.pairs[out.m * 2 + 1] = b;
      out.dists[out.m] = Math.sqrt(nbrD[q]);
      out.m++;
    }
  }
}
