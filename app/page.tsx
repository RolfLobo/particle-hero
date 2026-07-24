"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CONSTELLATION_BASE,
  DEFAULT_SETTINGS,
  PORTRAITS,
  type RenderStyle,
  type Settings,
} from "./portraits";
import ParticlePortrait from "./components/ParticlePortrait";
import ControlPanel, { FRAME_PRESETS, type Frame } from "./components/ControlPanel";
import ExportDialog from "./components/ExportDialog";
import PortraitNav from "./components/PortraitNav";
import HeroOverlay from "./components/HeroOverlay";
import { DEFAULT_HERO, type HeroState } from "./components/heroDesigns";

/** Preview-box CSS for the chosen frame (the exported effect fills its host). */
function frameStyle(frame: Frame): CSSProperties {
  if (frame.preset === "full") return { width: "100%", height: "100%" };
  const isCustom = frame.preset === "custom";
  const p = FRAME_PRESETS.find((f) => f.id === frame.preset);
  const aw = isCustom ? frame.w : (p?.aw ?? 16);
  const ah = isCustom ? frame.h : (p?.ah ?? 9);
  const ratio = aw / ah;
  const caps = ["88vw", `calc((100vh - 9rem) * ${ratio})`];
  if (isCustom) caps.push(`${frame.w}px`);
  // Largest box of this aspect that fits the available preview area.
  return { width: `min(${caps.join(", ")})`, aspectRatio: `${aw} / ${ah}` };
}

/**
 * Phones draw the subject far smaller and have a fraction of the fill-rate, so
 * the particle DEFAULT is scaled down for them. Deliberately applied as a
 * default (not a hidden multiplier at draw time) so the panel always shows the
 * real number — the count you read is the count you get.
 */
const PHONE_COUNT_SCALE = 0.4;

const matchesPhone = () =>
  window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;

export default function ParticlePortraitPage() {
  const [activeId, setActiveId] = useState(PORTRAITS[0].id);
  const [settings, setSettings] = useState<Settings>({
    ...DEFAULT_SETTINGS,
    ...PORTRAITS[0].defaults,
  });
  const [frame, setFrame] = useState<Frame>({ preset: "full", w: 1280, h: 720 });
  const [exportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<"particles" | "source">("particles");
  const [hero, setHero] = useState<HeroState>(DEFAULT_HERO);
  const [panelOpen, setPanelOpen] = useState(false);

  // Device tuning, applied after mount rather than in the initial state so the
  // server and client render identical markup.
  const countScale = useRef(1);
  useEffect(() => {
    let settled = false;
    const apply = () => {
      if (settled) return;
      // A zero-width viewport means the environment hasn't laid out yet (an
      // occluded or prerendering tab reports 0) — that would masquerade as a
      // phone, so assume desktop for now and correct when a real width lands.
      if (!window.innerWidth) {
        setPanelOpen(true);
        return;
      }
      settled = true;
      const phone = matchesPhone();
      countScale.current = phone ? PHONE_COUNT_SCALE : 1;
      // Desktop: open the panel — it's the point of the page and there's room.
      // Phone: leave the sheet closed so the artwork lands first.
      setPanelOpen(!phone);
      if (phone)
        setSettings((s) => ({ ...s, count: Math.round(s.count * PHONE_COUNT_SCALE) }));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  /** A portrait's `defaults` carry a desktop-sized count — scale it to the device. */
  const scaled = (patch: Partial<Settings>): Partial<Settings> =>
    patch.count === undefined
      ? patch
      : { ...patch, count: Math.round(patch.count * countScale.current) };

  const active = useMemo(
    () => PORTRAITS.find((p) => p.id === activeId) ?? PORTRAITS[0],
    [activeId],
  );

  // Each style remembers its own tuned settings — flipping the switch is
  // non-destructive. Cleared when the portrait changes (each portrait carries
  // its own defaults).
  const styleMemory = useRef<Partial<Record<RenderStyle, Settings>>>({});

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

  const handleChange = (patch: Partial<Settings>) => {
    // Stash in the handler body, not inside the updater — React expects state
    // updaters to be pure (StrictMode double-invokes them). The panel fires
    // discrete events, so this render's `settings` is current.
    if (patch.style && patch.style !== settings.style)
      styleMemory.current[settings.style] = settings;
    setSettings((s) => {
      if (patch.style && patch.style !== s.style) {
        const remembered = styleMemory.current[patch.style];
        if (remembered) return { ...remembered };
        if (patch.style === "constellation") {
          const p = PORTRAITS.find((q) => q.id === activeId);
          return { ...s, ...CONSTELLATION_BASE, ...p?.constellation };
        }
        // Reached when a portrait switch (made while in constellation) cleared
        // the memory: keep the current look — background, polarity, colour,
        // cursor, zoom — and re-apply the portrait's dots density at device scale.
        const d = PORTRAITS.find((q) => q.id === activeId)?.defaults;
        return {
          ...s,
          style: "dots",
          size: d?.size ?? DEFAULT_SETTINGS.size,
          ...scaled({ count: d?.count ?? DEFAULT_SETTINGS.count }),
        };
      }
      return { ...s, ...patch };
    });
  };

  const handleHeroChange = (patch: Partial<HeroState>) =>
    setHero((h) => ({ ...h, ...patch }));

  const isFull = frame.preset === "full";

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#0b0b0c] text-white">
      <div
        className={`absolute inset-0 grid place-items-center ${isFull ? "p-0" : "p-6 sm:p-8"}`}
      >
        <div
          className={`relative ${
            isFull ? "" : "overflow-hidden rounded-sm shadow-2xl shadow-black/60 ring-1 ring-white/15"
          }`}
          style={frameStyle(frame)}
        >
          <ParticlePortrait
            key={active.id}
            src={active.src}
            kind={active.kind}
            bg={active.bg}
            settings={settings}
            view={view}
            label={`${active.name}, rendered as particles`}
          />
          <HeroOverlay hero={hero} settings={settings} />
        </div>
      </div>

      <ControlPanel
        settings={settings}
        onChange={handleChange}
        view={view}
        onViewChange={setView}
        frame={frame}
        onFrameChange={setFrame}
        onExport={() => setExportOpen(true)}
        hero={hero}
        onHeroChange={handleHeroChange}
        open={panelOpen}
        onOpenChange={setPanelOpen}
      />
      <PortraitNav
        portraits={PORTRAITS}
        activeId={activeId}
        onSelect={handleSelect}
        obscured={panelOpen}
      />

      {exportOpen && (
        <ExportDialog
          settings={settings}
          portrait={{ src: active.src, kind: active.kind, bg: active.bg }}
          onClose={() => setExportOpen(false)}
        />
      )}
    </main>
  );
}
