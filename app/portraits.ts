// Registry of "portrait experiments". Add an entry here and it appears in the
// on-screen nav automatically — no other wiring needed.

export type CursorStyle = "dot" | "ring" | "crosshair";

/** How the subject is separated from its background before sampling. */
export type BgRemoval =
  // The image already has a transparent background (a cutout PNG).
  | { mode: "alpha" }
  // Flood-fill a solid-ish background colour from the image borders. Interior
  // regions of that colour (e.g. a bright ring enclosed by dark hair) are kept.
  | {
      mode: "chroma";
      color: [number, number, number];
      /** 0–1, how close a pixel must be to `color` to count as background. */
      tolerance: number;
      /** Only remove background reachable from the image border (default true). */
      fromBorder?: boolean;
    };

/** Colour the particles reveal. `none` = use the flat `color`; otherwise the
 *  specks act as a mask onto a canvas-space gradient. This colours the PARTICLES
 *  (the "particle fill"), not the backdrop — see `Background` for that. */
export type Gradient = {
  type: "none" | "linear" | "radial";
  from: string;
  to: string;
  /** Linear only: degrees, 0 = left→right, increasing clockwise. */
  angle: number;
};

/**
 * How the particles composite, which is inseparable from the backdrop:
 * - `light-on-dark`: additive glow (today's look) — light specks on a dark bg.
 * - `dark-on-light`: multiply "ink" — dark specks that deepen where they
 *   overlap, on a light bg. The graphite mirror of the glow.
 */
export type Polarity = "light-on-dark" | "dark-on-light";

/** The real backdrop painted BEHIND the particles (replaces the old #000 clear). */
export type Background =
  | { type: "solid"; color: string }
  | { type: "linear"; from: string; to: string; angle: number }
  | { type: "radial"; from: string; to: string };

/** How the subject fills its container (applies to the export too). */
export type Fit = "contain" | "cover";

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

export type Settings = {
  /** "dots" = classic dense specks; "constellation" = sparse stars + links. */
  style: RenderStyle;
  /** Line behaviour when style is "constellation". */
  links: LinkSettings;
  /** Additive glow (light-on-dark) vs. multiply ink (dark-on-light). */
  polarity: Polarity;
  /** The backdrop behind the particles. */
  background: Background;
  /** contain = whole subject visible (inset); cover = fills the frame, crops. */
  fit: Fit;
  /** Scale multiplier on the fit (1 = default; >1 zooms in / crops more). */
  zoom: number;
  /** Number of particles. */
  count: number;
  /** Size of each speck, in CSS pixels. */
  size: number;
  /** 0–1. Modulates each speck's brightness by source luminance: highlights
   *  blaze, shadows recede. 0 = flat (all specks equal). */
  contrast: number;
  /** Flat particle colour (used when `gradient.type === "none"`) + the cursor. */
  color: string;
  /** Gradient revealed through the particle mask (the "particle fill"). */
  gradient: Gradient;
  /** Cursor radius — both the visual size and how far it pushes particles. */
  cursorSize: number;
  cursorStyle: CursorStyle;
};

export type Portrait = {
  id: string;
  name: string;
  /** URL under /public (e.g. /foo.png or .mp4). */
  src: string;
  /** "image" (default) or "video" — a short muted loop, mask-lit per frame. */
  kind?: "image" | "video";
  /** Background removal — images only (video uses per-frame luminance). */
  bg?: BgRemoval;
  /** Per-portrait overrides, merged over DEFAULT_SETTINGS when selected. */
  defaults?: Partial<Settings>;
  /** Extra overrides applied on top of CONSTELLATION_BASE for this portrait. */
  constellation?: Partial<Settings>;
};

export const DEFAULT_SETTINGS: Settings = {
  style: "dots",
  links: { reach: 60, perDot: 3, strength: 0.6 },
  polarity: "light-on-dark",
  background: { type: "solid", color: "#000000" },
  fit: "contain",
  zoom: 1,
  count: 42000,
  size: 1.25,
  contrast: 0.5,
  color: "#ffffff",
  gradient: { type: "none", from: "#5b8cff", to: "#0a1a3f", angle: 90 },
  cursorSize: 90,
  cursorStyle: "ring",
};

/**
 * Baseline for the Constellation style: far fewer, larger dots. Per-portrait
 * `constellation` overrides layer on top when the style is switched on.
 * `contrast` is pinned here (not inherited from the outgoing dots settings) so
 * switching portraits mid-constellation always lands on a tuned tone curve.
 */
export const CONSTELLATION_BASE: Partial<Settings> = {
  style: "constellation",
  count: 1600,
  size: 2.4,
  contrast: 0.5,
  links: { reach: 70, perDot: 3, strength: 0.75 },
};

/**
 * One-click coherent "looks": each pairs a polarity with a matching backdrop +
 * particle colour, so Background and Particles stay in sync. Applying a look
 * resets the particle fill to flat colour (layer a gradient on afterwards).
 */
export type LookPreset = {
  id: string;
  name: string;
  polarity: Polarity;
  background: Background;
  /** Particle (and cursor) colour. */
  color: string;
};

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: "light-on-black",
    name: "Light on black",
    polarity: "light-on-dark",
    background: { type: "solid", color: "#000000" },
    color: "#ffffff",
  },
  {
    id: "warm-dusk",
    name: "Warm dusk",
    polarity: "light-on-dark",
    background: { type: "radial", from: "#2a1c33", to: "#050308" },
    color: "#ffd7a1",
  },
  {
    id: "deep-sea",
    name: "Deep sea",
    polarity: "light-on-dark",
    background: { type: "linear", from: "#06232c", to: "#01080f", angle: 120 },
    color: "#8fe9ff",
  },
  {
    id: "ink-on-cream",
    name: "Ink on cream",
    polarity: "dark-on-light",
    background: { type: "solid", color: "#efe7d6" },
    color: "#161310",
  },
  {
    id: "graphite",
    name: "Graphite",
    polarity: "dark-on-light",
    background: { type: "linear", from: "#eef1f5", to: "#c7d0db", angle: 120 },
    color: "#1b2026",
  },
  {
    id: "sepia",
    name: "Sepia",
    polarity: "dark-on-light",
    background: { type: "solid", color: "#f2e6d0" },
    color: "#3a2a17",
  },
];

/** Sensible default look when flipping the polarity toggle. */
export const POLARITY_DEFAULT_LOOK: Record<Polarity, LookPreset> = {
  "light-on-dark": LOOK_PRESETS[0],
  "dark-on-light": LOOK_PRESETS[3],
};

/** Curated backdrop gradients for the panel swatch row. */
export const GRADIENT_PRESETS: { id: string; name: string; gradient: Gradient }[] = [
  { id: "none", name: "None", gradient: { type: "none", from: "#ffffff", to: "#ffffff", angle: 90 } },
  { id: "ember", name: "Ember", gradient: { type: "linear", from: "#ff7a3c", to: "#5c0a1e", angle: 20 } },
  { id: "ice", name: "Ice", gradient: { type: "linear", from: "#8fe9ff", to: "#12347f", angle: 115 } },
  { id: "gold", name: "Gold", gradient: { type: "linear", from: "#ffd889", to: "#6a3c07", angle: 90 } },
  { id: "verdant", name: "Verdant", gradient: { type: "linear", from: "#c4ff87", to: "#0a5347", angle: 120 } },
  { id: "rose", name: "Rose", gradient: { type: "radial", from: "#ff9ab5", to: "#5e0f2c", angle: 90 } },
];

export const PORTRAITS: Portrait[] = [
  {
    id: "statue-profile",
    name: "Statue Profile",
    src: "/statue-profile.png",
    bg: { mode: "alpha" },
    defaults: { contrast: 0.5 },
  },
  {
    id: "flower-paper",
    name: "Flower Paper",
    src: "/flower-paper.png",
    bg: { mode: "alpha" },
    // Evenly-lit photo — needs more contrast to read as sculpted light.
    defaults: { contrast: 0.7 },
    // …but as a constellation the mid-tones ARE the subject: flatten the tone
    // curve and strengthen the lines or the web barely registers.
    constellation: {
      count: 1800,
      contrast: 0.25,
      links: { reach: 70, perDot: 3, strength: 0.8 },
    },
  },
  {
    id: "parrot-flight",
    name: "Parrot Flight",
    src: "/parrot-flight.mp4",
    kind: "video",
    // Subject on black; more particles so the live pose reads within the
    // wider flight envelope the placement covers.
    defaults: { count: 50000, contrast: 0.45 },
    // Moving subject spans a wider envelope — a few more stars keep the pose readable.
    constellation: { count: 1800, contrast: 0.3 },
  },
  {
    id: "glass-material",
    name: "Glass Material",
    src: "/glass-material.mp4",
    kind: "video",
    defaults: { count: 50000, contrast: 0.45 },
    // Dark, low-luminance clip: flatten the curve and push the lines hard or
    // the orb disappears.
    constellation: {
      count: 1800,
      contrast: 0.15,
      links: { reach: 70, perDot: 3, strength: 0.9 },
    },
  },
];
