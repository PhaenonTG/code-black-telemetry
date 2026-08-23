export type LayerVisual = "radar" | "alerts" | "team" | "spotter" | "poi" | "trail" | "road" | "camera" | "probe" | "network";

// Shared between the dedicated Layers page and the on-map layers popover so both surfaces use the
// same icon per layer instead of the popover staying icon-less while the page has a full glyph set.
export function LayerGlyph({ visual }: { visual: LayerVisual }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  if (visual === "radar") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 12 18 8M12 12l2 7M4 12h16" /></svg>;
  if (visual === "alerts") return <svg {...common}><path d="M12 3 3 20h18L12 3Z" /><path d="M12 8v5M12 17h.01" /></svg>;
  if (visual === "team") return <svg {...common}><path d="M12 4 5 20h14L12 4Z" /><circle cx="12" cy="13" r="2" /></svg>;
  if (visual === "spotter") return <svg {...common}><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M4 20c1-4 7-4 8 0M12 20c1-4 7-4 8 0" /></svg>;
  if (visual === "poi") return <svg {...common}><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>;
  if (visual === "trail") return <svg {...common}><path d="M4 18c3-8 7 4 10-4 1.4-3.8 3-6 6-7" /><circle cx="4" cy="18" r="1.5" /><circle cx="20" cy="7" r="1.5" /></svg>;
  if (visual === "road") return <svg {...common}><path d="M8 21 11 3M16 21 13 3M5 14h14M6 8h12" /></svg>;
  if (visual === "camera") return <svg {...common}><path d="M4 8h4l2-3h4l2 3h4v11H4z" /><circle cx="12" cy="13" r="3" /></svg>;
  if (visual === "probe") return <svg {...common}><path d="M12 3v11" /><circle cx="12" cy="17" r="4" /><path d="M8 21h8" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M4 12h5M15 12h5M12 4v5M12 15v5" /></svg>;
}
