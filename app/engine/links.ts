// Nearest-neighbour link building for the constellation style. Pure — no DOM,
// no engine state — so it unit-tests headlessly and bundles into the embed.
//
// Uniform grid with cell size = reach: any neighbour within reach of a dot is
// in its own or an adjacent cell, so each dot inspects at most 9 cells.

export type LinkBuffers = {
  /** Flattened pairs [a0,b0, a1,b1, ...] with a < b. */
  pairs: Int32Array;
  /** Centre-to-centre distance of each pair (same index). */
  dists: Float32Array;
  /** Valid pair count. */
  m: number;
  /** Capacity (pairs). */
  cap: number;
};

export function makeLinkBuffers(cap: number): LinkBuffers {
  return { pairs: new Int32Array(cap * 2), dists: new Float32Array(cap), m: 0, cap };
}

const MAX_PER_DOT = 5;

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
  const cells = gw * gh;
  const counts = new Int32Array(cells + 1);
  for (let i = 0; i < n; i++) counts[cellY(i) * gw + cellX(i) + 1]++;
  for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
  const order = new Int32Array(n);
  const cursor = counts.slice(0, cells);
  for (let i = 0; i < n; i++) order[cursor[cellY(i) * gw + cellX(i)]++] = i;

  const reachSq = reach * reach;
  const k = Math.min(MAX_PER_DOT, perDot | 0);
  const nbr = new Int32Array(k);
  const nbrD = new Float32Array(k); // squared distances, ascending
  const seen = new Set<number>();

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
