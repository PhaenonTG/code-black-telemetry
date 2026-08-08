import { useCallback, useEffect, useRef, useState } from "react";
import { useGridSplitter } from "../../hooks/useGridSplitter";
import {
  clampWeatherGridLayout,
  getWeatherGridLayout,
  loadWeatherGridLayout,
  saveWeatherGridLayout,
  subscribeWeatherGridLayout,
  type WeatherGridLayout,
} from "../../services/settings";

function getGrid(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".page-grid--weather");
}

// Mirrors what index.css's landscape/portrait blocks read -- see the "single source of truth"
// blocks there. Keeping this in one place means a drag can never leave the grid reading a
// different value than what's actually driving layout.
function applyLayoutToGrid(grid: HTMLElement, layout: WeatherGridLayout) {
  grid.style.setProperty("--wx-col-left", String(layout.colSplitLeft));
  grid.style.setProperty("--wx-col-right", String(layout.colSplitRight));
  grid.style.setProperty("--wx-row-split", `${layout.rowSplit}fr`);
  grid.style.setProperty("--wx-row-split-inv", `${100 - layout.rowSplit}fr`);
  layout.portraitHeights.forEach((h, i) => {
    grid.style.setProperty(`--wx-p-h-${i + 1}`, `${h}dvh`);
  });
}

// Dragging portrait divider `i` (between stacked cards i and i+1) only redistributes those two
// cards' heights, keeping their combined height (and every other card's height) fixed -- the same
// "drag one shared edge, both sides move" model as the landscape splitters, generalized to a chain
// of 6 stacked cards instead of 2 side-by-side ones.
function applyPortraitDivider(heights: WeatherGridLayout["portraitHeights"], dividerIndex: number, fraction: number): WeatherGridLayout["portraitHeights"] {
  const next = [...heights] as WeatherGridLayout["portraitHeights"];
  const cumulativeBefore = heights.slice(0, dividerIndex).reduce((a, b) => a + b, 0);
  const pairSum = heights[dividerIndex] + heights[dividerIndex + 1];
  const desiredCumulative = fraction * 100;
  const newFirst = Math.min(cumulativeBefore + pairSum, Math.max(cumulativeBefore, desiredCumulative)) - cumulativeBefore;
  next[dividerIndex] = newFirst;
  next[dividerIndex + 1] = pairSum - newFirst;
  return next;
}

interface HandleProps {
  axis: "x" | "y";
  positionPercent: number;
  onMove: (fraction: number) => void;
  onEnd: () => void;
  ariaLabel: string;
}

function SplitterHandle({ axis, positionPercent, onMove, onEnd, ariaLabel }: HandleProps) {
  const dragHandlers = useGridSplitter({ getContainer: getGrid, axis, onMove, onEnd });
  // Pure visual overlay, not real grid content -- position: absolute against the grid container
  // (made position: relative in index.css) rather than participating in grid placement, since
  // mixing percentage top/left with grid-row/grid-column placement doesn't compose the way you'd
  // want here.
  const style: React.CSSProperties =
    axis === "x"
      ? { position: "absolute", left: `${positionPercent}%`, top: 0, bottom: 0, width: 44, marginLeft: -22 }
      : { position: "absolute", top: `${positionPercent}%`, left: 0, right: 0, height: 44, marginTop: -22 };
  return (
    <div
      className={`wx-splitter wx-splitter--${axis}`}
      style={style}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      {...dragHandlers}
    >
      <div className="wx-splitter__line" />
    </div>
  );
}

export function WeatherGridSplitters() {
  const [layout, setLayout] = useState<WeatherGridLayout>(getWeatherGridLayout());
  const [isLandscape, setIsLandscape] = useState(() => window.matchMedia("(orientation: landscape)").matches);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    void loadWeatherGridLayout();
    return subscribeWeatherGridLayout((next) => {
      setLayout(next);
      const grid = getGrid();
      if (grid) applyLayoutToGrid(grid, next);
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const handler = () => setIsLandscape(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const applyLive = useCallback((partial: Partial<WeatherGridLayout>) => {
    const next = clampWeatherGridLayout({ ...layoutRef.current, ...partial });
    layoutRef.current = next;
    setLayout(next);
    const grid = getGrid();
    if (grid) applyLayoutToGrid(grid, next);
  }, []);

  const commit = useCallback(() => {
    void saveWeatherGridLayout(layoutRef.current);
  }, []);

  if (isLandscape) {
    return (
      <>
        <SplitterHandle
          axis="x"
          positionPercent={layout.colSplitLeft}
          onMove={(fraction) => applyLive({ colSplitLeft: fraction * 100 })}
          onEnd={commit}
          ariaLabel="Resize Location/Alerts column"
        />
        <SplitterHandle
          axis="x"
          positionPercent={layout.colSplitRight}
          onMove={(fraction) => applyLive({ colSplitRight: fraction * 100 })}
          onEnd={commit}
          ariaLabel="Resize Wind/Nearby column"
        />
        <SplitterHandle
          axis="y"
          positionPercent={layout.rowSplit}
          onMove={(fraction) => applyLive({ rowSplit: fraction * 100 })}
          onEnd={commit}
          ariaLabel="Resize top/bottom row height"
        />
      </>
    );
  }

  // Portrait: 5 handles between the 6 stacked cards, positioned at the cumulative height (in dvh,
  // matching the grid's own row units) up to each divider.
  const cumulative: number[] = [];
  let running = 0;
  for (const h of layout.portraitHeights) {
    running += h;
    cumulative.push(running);
  }

  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <SplitterHandle
          key={i}
          axis="y"
          positionPercent={cumulative[i]}
          onMove={(fraction) => applyLive({ portraitHeights: applyPortraitDivider(layoutRef.current.portraitHeights, i, fraction) })}
          onEnd={commit}
          ariaLabel={`Resize stacked card divider ${i + 1}`}
        />
      ))}
    </>
  );
}
