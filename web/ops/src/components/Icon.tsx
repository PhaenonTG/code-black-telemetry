const PATHS: Record<string, string> = {
  home: "M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z",
  map: "M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6zM9 4v14M15 6v14",
  radar: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 12l5-5M12 12h8M12 12l3 7M12 12L5 9",
  cloud: "M7 18a4 4 0 01-.6-7.96A5 5 0 0117 9a4 4 0 010 8H7z",
  alert: "M12 3l9 16H3l9-16zM12 10v4m0 3h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  fleet: "M3 13l1.5-5A2 2 0 016.4 7h11.2a2 2 0 011.9 1.4L21 13m-18 0v5a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-5m-18 0h18M7 16h.01M17 16h.01",
  ops: "M12 2l7 3v5c0 4.4-2.7 7.6-7 10-4.3-2.4-7-5.6-7-10V5l7-3z",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 003.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8c.36.24.8.4 1.51.4H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  radio: "M8 12a4 4 0 018 0m-11 0a7 7 0 0114 0m-17 0a10 10 0 0120 0",
  models: "M4 18h16M6 14l4-4 3 3 5-7M6 6h.01M9 6h.01M12 6h.01",
  sounding: "M6 20V4m0 0h12M6 9h8M6 14h11M6 19h5",
  consensus: "M4 7h7v7H4zM13 10h7v7h-7zM7 17h7v4H7z",
  target: "M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 100 8 4 4 0 000-8z",
  stream: "M4 6h16v10H4zM8 20h8M12 16v4M10 9l5 2.8-5 2.8z",
  camera: "M3 6h12v12H3zM15 10l6-4v12l-6-4M7 10h.01",
  analysis: "M5 20V12M12 20V4M19 20V8",
  expand: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  pin: "M9 3h6l-1 6 4 4H6l4-4-1-6zM12 13v8",
  close: "M5 5l14 14M19 5L5 19",
  refresh: "M20 7v5h-5M4 17v-5h5M19 12a7 7 0 00-12-5L4 10M5 12a7 7 0 0012 5l3-3",
  arrow: "M5 12h14M13 6l6 6-6 6",
  team: "M8 11a4 4 0 100-8 4 4 0 000 8zM2 21v-3a6 6 0 0112 0v3M16 4a4 4 0 010 8M17 15a5 5 0 015 5v1",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2",
  system: "M4 6h16M4 12h16M4 18h16M7 6v.01M7 12v.01M7 18v.01",
  chevron: "M9 6l6 6-6 6",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  lock: "M7 11V8a5 5 0 0110 0v3m-11 0h12v10H6V11z",
  gps: "M12 2v2m0 16v2M2 12h2m16 0h2M12 8a4 4 0 100 8 4 4 0 000-8z",
  eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z M12 15a3 3 0 100-6 3 3 0 000 6z",
  eyeOff: "M3 3l18 18 M10.6 10.6a3 3 0 004.2 4.2 M9.4 5.3A11 11 0 0112 5c7 0 11 7 11 7a13.4 13.4 0 01-3.2 3.9 M6.1 6.1A13.6 13.6 0 001 12s4 7 11 7c1.3 0 2.5-.2 3.6-.6",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9",
}

export function Icon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} width="1.15em" height="1.15em">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
