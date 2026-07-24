# Constellation Lines Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a second render style — "Constellation": few hundred–few thousand larger dots joined by nearest-neighbour lines that fade with length — selectable in the side panel and shipped through the export/embed unchanged.

**Architecture:** All rendering lives in the shared engine `app/engine/core.ts` (used by both the React app and the embed bundle). Link-finding is a pure function in a new `app/engine/links.ts` (unit-testable, no DOM). New `Settings` fields `style` + `links` flow through the existing settings pipeline: panel → page state → engine `update()` → export JSON → embed defaults. Missing `style` in old embed configs defaults to `"dots"`, so nothing already published changes.

**Tech Stack:** Next.js 16 / React 19 / TS strict, Canvas 2D, esbuild for the embed bundle, vitest (new dev-dep) for the pure link logic. pnpm.

**Design doc:** `docs/plans/2026-07-24-constellation-lines-design.md`

**Pre-flight:** Apply `~/CodeProjects/hero-boilerplate/docs/web-build-gotchas.md`. Directly relevant entries:
- *Strict-TS null-narrowing lost in hoisted closures* → verify with `pnpm exec tsc --noEmit`, not just dev/lint.
- *MCP browser tab may not run rAF* → verify visuals with the in-app Browser pane (visible → rAF runs) or headless Playwright, and check state via DOM/JS, not only screenshots.
- *`ctx.filter` per-draw cost* → we don't use filters; keep it that way.

---

### Task 1: Pure link-builder with tests (`app/engine/links.ts`)

**Files:**
- Create: `app/engine/links.ts`
- Create: `app/engine/links.test.ts`
- Modify: `package.json` (add vitest + `test` script)

**Step 1: Install vitest**

```bash
pnpm add -D vitest
```

Add to `package.json` scripts: `"test": "vitest run"`.

**Step 2: Write the failing tests** — `app/engine/links.test.ts`:

```ts
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
```

**Step 3: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — cannot resolve `./links`.

**Step 4: Implement** — `app/engine/links.ts`:

```ts
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
```

**Step 5: Run tests** — `pnpm test` → all PASS.

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml app/engine/links.ts app/engine/links.test.ts
git commit -m "feat: nearest-neighbour link builder for constellation style"
```

---

### Task 2: Settings plumbing (`portraits.ts`, embed defaults, export)

**Files:**
- Modify: `app/portraits.ts` (types + defaults + per-portrait constellation variants)
- Modify: `app/engine/embed.entry.ts` (DEFAULTS)
- Modify: `app/components/ExportDialog.tsx` (`buildConfig`)

**Step 1:** In `app/portraits.ts`, after the `Fit` type add:

```ts
/** How the field renders: dense specks, or sparse stars joined by lines. */
export type RenderStyle = "dots" | "constellation";

/** Line behaviour — constellation style only. */
export type LinkSettings = {
  /** Neighbour search radius in CSS px at contain/zoom = 1 (scales with zoom). */
  reach: number;
  /** Links each dot makes to its nearest neighbours (1–5). */
  perDot: number;
  /** 0–1 overall line opacity, on top of the automatic fade-by-length. */
  strength: number;
};
```

Add to `Settings` (top of the type, above `polarity`):

```ts
  /** "dots" = classic dense specks; "constellation" = sparse stars + links. */
  style: RenderStyle;
  /** Line behaviour when style is "constellation". */
  links: LinkSettings;
```

Add to `DEFAULT_SETTINGS` (top):

```ts
  style: "dots",
  links: { reach: 60, perDot: 3, strength: 0.6 },
```

Add to the `Portrait` type after `defaults`:

```ts
  /** Extra overrides applied on top of CONSTELLATION_BASE for this portrait. */
  constellation?: Partial<Settings>;
```

After `DEFAULT_SETTINGS` add:

```ts
/**
 * Baseline for the Constellation style: far fewer, larger dots. Per-portrait
 * `constellation` overrides layer on top when the style is switched on.
 */
export const CONSTELLATION_BASE: Partial<Settings> = {
  style: "constellation",
  count: 1400,
  size: 2.4,
  links: { reach: 70, perDot: 3, strength: 0.65 },
};
```

Give the two video portraits `constellation: { count: 1800 }` (their subject moves through a wider envelope). Images need no override yet — tuning happens in Task 6.

**Step 2:** In `app/engine/embed.entry.ts` add to `DEFAULTS` (keep-in-sync comment already covers it):

```ts
  style: "dots",
  links: { reach: 60, perDot: 3, strength: 0.6 },
```

**Step 3:** In `app/components/ExportDialog.tsx` `buildConfig`, after `config.cursorStyle = ...`:

```ts
  config.style = settings.style;
  if (settings.style === "constellation") config.links = settings.links;
```

**Step 4: Verify** — `pnpm exec tsc --noEmit` → clean (this proves every Settings construction site got the new fields).

**Step 5: Commit**

```bash
git add app/portraits.ts app/engine/embed.entry.ts app/components/ExportDialog.tsx
git commit -m "feat: style + links settings, constellation defaults, export passthrough"
```

---

### Task 3: Engine — draw the links (`app/engine/core.ts`)

**Files:**
- Modify: `app/engine/core.ts`

**Step 1:** Import: `import { buildLinks, makeLinkBuffers } from "./links";`

**Step 2:** Constants (near the other tuning constants):

```ts
const MAX_LINKS = 24000; // hard cap on line segments per frame
const LINK_WIDTH_FRAC = 0.35; // line width as a fraction of the star size
const CONSTELLATION_MIN_COUNT = 100; // sparse mode floor (dots mode keeps 2000)
```

**Step 3:** Make `targetCount()` style-aware (replace the existing const):

```ts
  // `count` means exactly what the panel says. The clamp only guards
  // hand-written embed configs — nothing in the UI can reach it. Constellation
  // is sparse by design, so its floor is far lower.
  const targetCount = (): number => {
    const floor = settings.style === "constellation" ? CONSTELLATION_MIN_COUNT : 2000;
    return Math.max(floor, Math.min(MAX_EFFECTIVE_COUNT, Math.round(count)));
  };
```

**Step 4:** Add the link pass after the `drawSpecks` definition. Same bucketed-alpha batching idea: one `stroke()` per alpha level.

```ts
  // Constellation link pass. Line alpha = strength × fade-with-length × the
  // dimmer endpoint's tone (the same curve as the specks, so lines vanish
  // exactly where dots do — video's unlit poses, deep shadows at high
  // contrast). Fade-by-length means a link at the reach boundary is already
  // invisible, so links appear/disappear without popping as dots drift.
  const linkBuf = makeLinkBuffers(MAX_LINKS);
  const lBright = new Float32Array(256); // luminance byte → dot tone
  const lBucket = new Uint8Array(MAX_LINKS); // pair → alpha bucket (255 = skip)
  const lCounts = new Int32Array(ALPHA_BUCKETS);
  const lStarts = new Int32Array(ALPHA_BUCKETS);
  const lCursor = new Int32Array(ALPHA_BUCKETS);
  const lOrder = new Int32Array(MAX_LINKS);

  const drawLinks = (baseAlpha: number) => {
    if (!field || !ctx || baseAlpha <= 0) return;
    const s = settings;
    const reach = s.links.reach * speckScale;
    buildLinks(field.x, field.y, field.count, reach, Math.round(s.links.perDot), linkBuf);
    const m = linkBuf.m;
    if (!m) return;

    const isVideo = kind === "video";
    const isInk = s.polarity === "dark-on-light";
    const floor = isVideo ? 0 : BRIGHT_FLOOR;
    const power = s.contrast * CONTRAST_POW_MAX;
    for (let v = 0; v < 256; v++) {
      const l = v / 255;
      if (isVideo && l < VIDEO_LUMA_GATE) {
        lBright[v] = 0;
        continue;
      }
      const tone = isInk && !isVideo ? 1 - l : l;
      lBright[v] = floor + (1 - floor) * Math.pow(tone, power);
    }

    const { x, y, lum } = field;
    const { pairs, dists } = linkBuf;
    const base = baseAlpha * s.links.strength;
    lCounts.fill(0);
    for (let p = 0; p < m; p++) {
      const a = pairs[p * 2];
      const b = pairs[p * 2 + 1];
      const fade = 1 - dists[p] / reach;
      const tone = Math.min(lBright[(lum[a] * 255) | 0], lBright[(lum[b] * 255) | 0]);
      const alpha = base * fade * tone;
      if (alpha < 0.004) {
        lBucket[p] = 255;
        continue;
      }
      const bk = Math.min(ALPHA_BUCKETS - 1, (alpha * ALPHA_BUCKETS) | 0);
      lBucket[p] = bk;
      lCounts[bk]++;
    }
    let acc = 0;
    for (let bk = 0; bk < ALPHA_BUCKETS; bk++) {
      lStarts[bk] = acc;
      lCursor[bk] = acc;
      acc += lCounts[bk];
    }
    for (let p = 0; p < m; p++) {
      if (lBucket[p] !== 255) lOrder[lCursor[lBucket[p]]++] = p;
    }

    ctx.globalCompositeOperation = isInk ? "multiply" : "lighter";
    ctx.strokeStyle = buildPaint();
    ctx.lineWidth = Math.max(0.5, s.size * speckScale * LINK_WIDTH_FRAC);
    for (let bk = 0; bk < ALPHA_BUCKETS; bk++) {
      const cnt = lCounts[bk];
      if (!cnt) continue;
      ctx.globalAlpha = (bk + 0.5) / ALPHA_BUCKETS;
      ctx.beginPath();
      const end = lStarts[bk] + cnt;
      for (let q = lStarts[bk]; q < end; q++) {
        const p = lOrder[q];
        ctx.moveTo(x[pairs[p * 2]], y[pairs[p * 2]]);
        ctx.lineTo(x[pairs[p * 2 + 1]], y[pairs[p * 2 + 1]]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
```

**Step 5:** Call it. In `tick()` replace the last draw line:

```ts
    if (morph < 1) {
      const a = intro * (1 - morph);
      if (settings.style === "constellation") drawLinks(a);
      drawSpecks(a);
    }
```

In `renderStatic()` before `drawSpecks(1)` add:

```ts
    if (settings.style === "constellation") drawLinks(1);
```

**Step 6:** In `update()` — a style flip changes the count floor and the whole
look, so force a resample. Replace the count-change block with:

```ts
      if (settings.style !== prev.style) {
        count = next.settings.count;
        resampleForDensity(true); // new density regime → always re-draw
      } else if (next.settings.count !== count) {
        count = next.settings.count;
        resampleForDensity(true); // new base density → always re-draw
      }
```

**Step 7: Verify** — `pnpm exec tsc --noEmit` clean, `pnpm test` green, `pnpm lint` clean.

**Step 8: Commit**

```bash
git add app/engine/core.ts
git commit -m "feat: constellation link rendering in the shared engine"
```

---

### Task 4: Panel — style switch + Links group (`app/components/ControlPanel.tsx`)

**Files:**
- Modify: `app/components/ControlPanel.tsx`

**Step 1:** Import `type RenderStyle` from `../portraits` (alongside the existing type imports). Add near `CURSOR_STYLES`:

```ts
const STYLES: { value: RenderStyle; label: string }[] = [
  { value: "dots", label: "Dots" },
  { value: "constellation", label: "Constellation" },
];
```

**Step 2:** The style switch is the headline choice, so it sits above the sections, pinned (not inside the scroll area). Insert directly after the `{/* Body */}` inner `<div className="overflow-hidden" inert={!open}>` opens, BEFORE the scrollable div:

```tsx
            {/* Style — the headline choice, pinned above the sections. */}
            <div className="border-t border-white/[0.07] px-3 py-2.5">
              <Segmented
                full
                value={settings.style}
                onChange={(style) => onChange({ style })}
                options={STYLES}
              />
            </div>
```

(The scrollable div below already has its own `border-t`.)

**Step 3:** In the Particles section, add at the top of the component body (near `const g = ...`):

```ts
  const isConstellation = settings.style === "constellation";
```

Make the Count slider style-aware:

```tsx
                <Slider
                  label="Count"
                  value={settings.count}
                  min={isConstellation ? 100 : 2000}
                  max={isConstellation ? 4000 : 90000}
                  step={isConstellation ? 50 : 1000}
                  display={settings.count.toLocaleString()}
                  onChange={(v) => onChange({ count: v })}
                />
```

**Step 4:** After the Contrast slider, add the Links group:

```tsx
                {isConstellation && (
                  <div className={`${WELL} space-y-2.5`}>
                    <Slider
                      label="Reach"
                      value={settings.links.reach}
                      min={20}
                      max={200}
                      step={5}
                      display={String(settings.links.reach)}
                      onChange={(v) => onChange({ links: { ...settings.links, reach: v } })}
                    />
                    <Slider
                      label="Links per dot"
                      value={settings.links.perDot}
                      min={1}
                      max={5}
                      step={1}
                      display={String(settings.links.perDot)}
                      onChange={(v) => onChange({ links: { ...settings.links, perDot: v } })}
                    />
                    <Slider
                      label="Line strength"
                      value={settings.links.strength}
                      min={0}
                      max={1}
                      step={0.05}
                      display={`${Math.round(settings.links.strength * 100)}%`}
                      onChange={(v) => onChange({ links: { ...settings.links, strength: v } })}
                    />
                  </div>
                )}
```

**Step 5: Verify** — `tsc --noEmit` + `pnpm lint` clean.

**Step 6: Commit**

```bash
git add app/components/ControlPanel.tsx
git commit -m "feat: style switch and links controls in the side panel"
```

---

### Task 5: Page — per-style settings memory (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx`

**Step 1:** Extend imports: `CONSTELLATION_BASE`, `type RenderStyle` from `./portraits`.

**Step 2:** Add a memory ref and make `handleChange` intercept style flips:

```ts
  // Each style remembers its own tuned settings — flipping the switch is
  // non-destructive. Cleared when the portrait changes (each portrait carries
  // its own defaults).
  const styleMemory = useRef<Partial<Record<RenderStyle, Settings>>>({});

  const handleChange = (patch: Partial<Settings>) =>
    setSettings((s) => {
      if (patch.style && patch.style !== s.style) {
        styleMemory.current[s.style] = s;
        const remembered = styleMemory.current[patch.style];
        if (remembered) return { ...remembered };
        if (patch.style === "constellation") {
          const p = PORTRAITS.find((q) => q.id === activeId);
          return { ...s, ...CONSTELLATION_BASE, ...p?.constellation };
        }
        return { ...DEFAULT_SETTINGS, ...PORTRAITS.find((q) => q.id === activeId)?.defaults };
      }
      return { ...s, ...patch };
    });
```

(`activeId` is component state, in scope. NOTE — review correction: the dots fallback IS reachable (constellation → portrait switch clears memory → flip back to dots). It must mirror the constellation fallback: preserve the current look via `{ ...s, style: "dots", ... }` and re-apply the portrait's dots density through `scaled()`. The implemented code does this; the literal block above predates the correction.)

**Step 3:** Portrait switch: reset memory and land in the equivalent look for the current style. Replace `handleSelect`:

```ts
  const handleSelect = (id: string) => {
    setActiveId(id);
    setView("particles");
    styleMemory.current = {};
    const p = PORTRAITS.find((q) => q.id === id);
    setSettings((s) =>
      s.style === "constellation"
        ? { ...s, ...CONSTELLATION_BASE, ...p?.constellation }
        : { ...s, ...scaled(p?.defaults ?? {}) },
    );
  };
```

(No phone count-scaling for constellation — a few hundred dots is cheap everywhere, and scaling would break the tuned look.)

**Step 4: Verify** — `tsc --noEmit` + lint clean.

**Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: per-style settings memory and constellation portrait defaults"
```

---

### Task 6: Visual verification + preset tuning

**Files:**
- Modify (tuning only): `app/portraits.ts`
- Rebuild: `public/embed/embed.js`

**Step 1:** Start the dev server via the Browser pane (`preview_start` with a `.claude/launch.json` entry for `pnpm dev`, port 3000). The pane is visible → rAF runs (per gotchas doc, don't trust hidden-tab screenshots).

**Step 2:** For each of the 4 portraits: flip to Constellation via the panel, screenshot, judge:
- Does the subject read at the default count?
- Are lines tracing features rather than mush? (If mush: lower perDot or reach.)
- Flip polarity to an ink look — lines must darken, not glow.
- Move the pointer through the web — deform + re-knit, no flicker.

Adjust `CONSTELLATION_BASE` / per-portrait `constellation` overrides until all four look good on first flip. Commit tuning separately:

```bash
git add app/portraits.ts
git commit -m "feat: tuned constellation presets per portrait"
```

**Step 3:** Rebuild the embed and round-trip it:

```bash
pnpm build:embed
ls -la public/embed/embed.js   # size sanity check vs git show HEAD:public/embed/embed.js | wc -c
```

Open Export while in Constellation → confirm `"style": "constellation"` + `links` in the JSON. Save the snippet into a scratchpad `test.html` pointing at `http://localhost:3000/statue-profile.png` + the freshly built embed.js, open it in the Browser pane, confirm identical rendering. Also test a config with NO `style` field → classic dots.

**Step 4: Commit the rebuilt embed**

```bash
git add public/embed/embed.js
git commit -m "chore: rebuild embed with constellation support"
```

---

### Task 7: Final gates

**Step 1:** Run everything:

```bash
pnpm test && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

All must pass — `next build` runs real tsc (per gotchas doc, dev+lint green is not enough).

**Step 2:** Add a line to `README.md`'s feature list describing the Constellation style (match the existing tone, one sentence).

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note the constellation style in the README"
```

Done — branch ready for review/merge discussion (superpowers:finishing-a-development-branch).
