import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../services/mapTiles";

type ReconStyle = "night" | "bright";

type ReconDiagnostics = {
  status: string;
  styleUri: string;
  userAgent: string;
  dpr: number;
  viewport: string;
  canvas: string;
  pixelSample: string;
  mapLoaded: boolean;
  styleLoaded: boolean;
  renderCount: number;
  idleCount: number;
  error: string;
  webgl: Record<string, string | number | boolean>;
  layerCount: number;
  sourceCount: number;
};

function webglCapabilities() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return { available: false };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const info: Record<string, string | number | boolean> = {
    available: true,
    version: gl.getParameter(gl.VERSION),
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    maxViewportWidth: gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0],
    maxViewportHeight: gl.getParameter(gl.MAX_VIEWPORT_DIMS)[1],
    extensions: gl.getSupportedExtensions()?.length ?? 0,
  };
  if (debug) {
    info.unmaskedVendor = gl.getParameter(debug.UNMASKED_VENDOR_WEBGL);
    info.unmaskedRenderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  }
  return info;
}

function styleFor(style: ReconStyle) {
  return style === "bright" ? "mapbox://styles/mapbox/streets-v12" : atlasStyleUri();
}

function sampleCanvasPixels(map: mapboxgl.Map) {
  try {
    const canvas = map.getCanvas();
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true }) ?? canvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl || canvas.width <= 0 || canvas.height <= 0) return "unavailable";
    const sample = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
    return `rgba(${sample[0]},${sample[1]},${sample[2]},${sample[3]})`;
  } catch (error) {
    return error instanceof Error ? `error:${error.name}` : "error";
  }
}

export function AtlasReconGlPage() {
  const params = new URLSearchParams(window.location.search);
  const envStyle = (import.meta.env.VITE_RECON_STYLE as string | undefined)?.trim().toLowerCase();
  const style = params.get("style") === "bright" || envStyle === "bright" ? "bright" : "night";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const renderCountRef = useRef(0);
  const idleCountRef = useRef(0);
  const [diagnostics, setDiagnostics] = useState<ReconDiagnostics>(() => ({
    status: "initializing",
    styleUri: styleFor(style),
    userAgent: navigator.userAgent,
    dpr: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    canvas: "none",
    pixelSample: "none",
    mapLoaded: false,
    styleLoaded: false,
    renderCount: 0,
    idleCount: 0,
    error: "",
    webgl: webglCapabilities(),
    layerCount: 0,
    sourceCount: 0,
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    if (!hasMapboxToken()) {
      setDiagnostics((current) => ({ ...current, status: "missing-token", error: "MAPBOX_TOKEN_MISSING" }));
      return;
    }
    mapboxgl.accessToken = mapboxAccessToken();
    const styleUri = styleFor(style);
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUri,
      center: [-94.1306, 36.4579],
      zoom: 8.8,
      attributionControl: true,
      pitch: 0,
      bearing: 0,
      fadeDuration: 0,
      preserveDrawingBuffer: true,
    });
    mapRef.current = map;
    const update = (status: string, error = "") => {
      const canvas = map.getCanvas();
      let layerCount = 0;
      let sourceCount = 0;
      try {
        const mapStyle = map.isStyleLoaded() ? map.getStyle() : null;
        layerCount = mapStyle?.layers?.length ?? 0;
        sourceCount = mapStyle?.sources ? Object.keys(mapStyle.sources).length : 0;
      } catch {
        // Style may still be loading.
      }
      const next: ReconDiagnostics = {
        status,
        styleUri,
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        canvas: `${canvas.width}x${canvas.height} css ${Math.round(canvas.getBoundingClientRect().width)}x${Math.round(canvas.getBoundingClientRect().height)}`,
        pixelSample: sampleCanvasPixels(map),
        mapLoaded: map.loaded(),
        styleLoaded: map.isStyleLoaded(),
        renderCount: renderCountRef.current,
        idleCount: idleCountRef.current,
        error,
        webgl: webglCapabilities(),
        layerCount,
        sourceCount,
      };
      window.localStorage.setItem("codeblack.atlas.recon.gl", JSON.stringify(next));
      setDiagnostics(next);
    };
    map.on("load", () => {
      map.addSource("recon-line", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [[-94.8, 36.2], [-94.13, 36.4579], [-93.6, 36.95]] },
          }],
        },
      });
      map.addLayer({
        id: "recon-line",
        type: "line",
        source: "recon-line",
        paint: { "line-color": "#ff2d35", "line-width": 4 },
      });
      new mapboxgl.Marker({ color: "#14a7ff" }).setLngLat([-94.1306, 36.4579]).addTo(map);
      update("loaded");
    });
    map.on("render", () => {
      renderCountRef.current += 1;
      if (renderCountRef.current % 30 === 0) update("rendering");
    });
    map.on("idle", () => {
      idleCountRef.current += 1;
      update("idle");
    });
    map.on("error", (event) => update("error", event.error?.message ?? "MAPBOX_GL_ERROR"));
    map.getCanvas().addEventListener("webglcontextlost", () => update("webgl-context-lost"));
    map.getCanvas().addEventListener("webglcontextrestored", () => update("webgl-context-restored"));
    const timer = window.setInterval(() => update(map.loaded() ? "poll-loaded" : "poll-loading"), 2_000);
    return () => {
      window.clearInterval(timer);
      map.remove();
      mapRef.current = null;
    };
  }, [style]);

  return (
    <main className="atlas-recon-page">
      <div ref={containerRef} className="atlas-recon-map" />
      <section className="atlas-recon-panel">
        <strong>GL JS Recon</strong>
        <span>{diagnostics.status}</span>
        <span>{diagnostics.styleUri}</span>
        <span>Canvas {diagnostics.canvas}</span>
        <span>Pixel {diagnostics.pixelSample}</span>
        <span>Loaded {String(diagnostics.mapLoaded)} / Style {String(diagnostics.styleLoaded)}</span>
        <span>Render {diagnostics.renderCount} / Idle {diagnostics.idleCount}</span>
        <span>Layers {diagnostics.layerCount} / Sources {diagnostics.sourceCount}</span>
        <span>DPR {diagnostics.dpr} / View {diagnostics.viewport}</span>
        <span>{String(diagnostics.webgl.unmaskedRenderer ?? diagnostics.webgl.renderer ?? "NO WEBGL")}</span>
        {diagnostics.error && <em>{diagnostics.error}</em>}
      </section>
    </main>
  );
}
