const PATHS: Record<string, string> = {
  home: "M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z",
  map: "M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6zM9 4v14M15 6v14",
  cloud: "M7 18a4 4 0 01-.6-7.96A5 5 0 0117 9a4 4 0 010 8H7z",
  alert: "M12 3l9 16H3l9-16zM12 10v4m0 3h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  fleet: "M3 13l1.5-5A2 2 0 016.4 7h11.2a2 2 0 011.9 1.4L21 13m-18 0v5a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-5m-18 0h18M7 16h.01M17 16h.01",
  ops: "M12 2l7 3v5c0 4.4-2.7 7.6-7 10-4.3-2.4-7-5.6-7-10V5l7-3z",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 003.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8c.36.24.8.4 1.51.4H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  radio: "M8 12a4 4 0 018 0m-11 0a7 7 0 0114 0m-17 0a10 10 0 0120 0",
  target: "M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 100 8 4 4 0 000-8z",
  chevron: "M9 6l6 6-6 6",
  lock: "M7 11V8a5 5 0 0110 0v3m-11 0h12v10H6V11z",
  gps: "M12 2v2m0 16v2M2 12h2m16 0h2M12 8a4 4 0 100 8 4 4 0 000-8z",
}

export function Icon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} width="1.15em" height="1.15em">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
