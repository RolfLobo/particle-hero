import { describe, expect, it } from "vitest";
import { buildLinks, makeLinkBuffers, type LinkBuffers } from "./links";

const f = (a: number[]) => Float32Array.from(a);

/** [a, b, dist] triples for easy assertions. */
function pairsOf(out: LinkBuffers): Array<[number, number, number]> {
  const r: Array<[number, number, number]> = [];
  for (let i = 0; i < out.m; i++)
    r.push([out.pairs[i * 2], out.pairs[i * 2 + 1], out.dists[i]]);
  return r;
}

describe("buildLinks", () => {
  it("links close dots once (deduped a<b) with the right distance", () => {
    const out = makeLinkBuffers(16);
    // dots at x = 0, 10, 100 — only the first two are within reach 20
    buildLinks(f([0, 10, 100]), f([0, 0, 0]), 3, 20, 2, out);
    expect(pairsOf(out)).toEqual([[0, 1, 10]]);
  });

  it("finds nothing beyond reach", () => {
    const out = makeLinkBuffers(16);
    buildLinks(f([0, 30]), f([0, 0]), 2, 20, 3, out);
    expect(out.m).toBe(0);
  });

  it("respects perDot (nearest wins)", () => {
    const out = makeLinkBuffers(16);
    // chain 0—10—21—33, reach 15, one link per dot:
    // 0→1 (10), 1→0 (dup), 2→1 (11), 3→2 (12)
    buildLinks(f([0, 10, 21, 33]), f([0, 0, 0, 0]), 4, 15, 1, out);
    expect(pairsOf(out)).toEqual([
      [0, 1, 10],
      [1, 2, 11],
      [2, 3, 12],
    ]);
  });

  it("links across grid-cell boundaries", () => {
    const out = makeLinkBuffers(16);
    // bbox 0..300, reach 60 → dot1 (x=55) and dot2 (x=65) land in adjacent
    // cells but are only 10 apart — they must still link.
    buildLinks(f([0, 55, 65, 300]), f([0, 0, 0, 0]), 4, 60, 2, out);
    expect(pairsOf(out)).toEqual([
      [0, 1, 55],
      [1, 2, 10],
    ]);
  });

  it("stops at the buffer cap", () => {
    const out = makeLinkBuffers(2);
    const xs = f([0, 1, 2, 3, 4, 5]);
    buildLinks(xs, f([0, 0, 0, 0, 0, 0]), 6, 10, 5, out);
    expect(out.m).toBe(2);
  });

  it("handles degenerate inputs", () => {
    const out = makeLinkBuffers(4);
    buildLinks(f([]), f([]), 0, 20, 3, out);
    expect(out.m).toBe(0);
    buildLinks(f([1]), f([1]), 1, 20, 3, out);
    expect(out.m).toBe(0);
    buildLinks(f([0, 5]), f([0, 0]), 2, 0, 3, out);
    expect(out.m).toBe(0);
  });
});
