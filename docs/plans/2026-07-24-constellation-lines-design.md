# Constellation Lines — Design

Date: 2026-07-24
Branch: `feature/constellation-lines`
Status: approved

## What we're building

A second rendering style for the particle portrait: **Constellation**. Instead of
~42k grain-sized dots, the portrait is built from a few hundred to a few
thousand larger "stars," each linked to its nearest neighbours by thin lines
that trace the subject. Selected via a style switch in the side panel, and
available everywhere at once — main site, export dialog, and the embeddable
`embed.js` — because all three share `app/engine/core.ts`.

## The look

- Dots keep the existing brightness + edge-weighted sampling, so at low counts
  they (and therefore the lines) naturally follow the subject's features.
- Each dot links to its N nearest neighbours within a reach radius.
- **Line brightness fades with length**: short links are strong, stretched links
  are faint. This makes the web "breathe" as dots drift, and eliminates
  pop-in/pop-out at the reach boundary (a link at the boundary is already at
  ~zero opacity).
- Cursor interaction is unchanged — the web deforms and re-knits around the
  pointer.
- Dots render slightly larger than in dots mode (stars, not grain).
- Line colour follows the active dot colour/gradient, dimmed.

## Panel

Style switch at the top: **Dots | Constellation**.

Constellation mode:
- Count slider gets a low range (~200–4,000).
- New **Links** group:
  - **Reach** — neighbour search radius.
  - **Links per dot** — 1–5.
  - **Line strength** — overall line opacity multiplier (on top of
    fade-by-length).
- Colour, gradient, background, fit/zoom, cursor size/style, dot size all work
  unchanged.
- Each style keeps its own remembered settings per portrait; switching back and
  forth is non-destructive.
- Every preset in `app/portraits.ts` gains a tuned constellation variant so all
  portraits look good on first flip.

## Settings & compatibility

- New fields: `style: "dots" | "constellation"` and
  `links: { reach: number; perDot: number; strength: number }`.
- Missing `style` defaults to `"dots"` → every already-published embed renders
  exactly as before.
- Export dialog needs no new UI; it already serialises full settings.

## Engine

- All logic in `app/engine/core.ts`, in the frame draw step, after positions
  update.
- Neighbour search via a uniform spatial grid (cell size ≈ reach), so each dot
  only inspects nearby cells. At ≤4k dots this is cheaper than today's 42k-dot
  render.
- Hard cap on total lines per frame as a guard against pathological slider
  combinations.
- Lines drawn on the same 2D canvas pass, batched by similar opacity where
  practical.

## Verification

1. Flip every portrait preset to Constellation; presets look good untouched.
2. Cursor interaction feels right at low and high counts.
3. Export an embed snippet with constellation active; open standalone and
   confirm identical rendering.
4. Rebuild `embed.js` (`pnpm build:embed`); bundle size stays reasonable.
5. An old-style config (no `style` field) still renders classic dots.

## Order of work

1. Engine: settings fields + spatial grid + line pass (behind `style`).
2. Panel: style switch + Links group + per-style settings memory.
3. Presets: constellation variants in `portraits.ts`.
4. Embed: rebuild, export round-trip test.

## Decisions log

- Line style: constellation web (vs low-poly mesh, contour drawing).
- Panel: style toggle with its own sliders (vs morphing slider, add-on lines).
- Scope: ship everywhere at once (site + export + embed) — cheap because the
  engine is shared.
