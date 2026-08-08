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
  grid.style.setProperty("--wx-row1-col-left", String(layout.row1ColSplitLeft));
  grid.style.setProperty("--wx-row1-col-right", String(layout.row1ColSplitRight));
  grid.style.setProperty("--wx-row2-col-left", String(layout.row2ColSplitLeft));
  grid.style.setProperty("--wx-row2-col-right", String(layout.row2ColSplitRight));
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
  // For "x" handles only: constrains the handle to one row's vertical extent instead of the full
  // grid height, since row1 and row2 now have independent column splits -- without this, a single
  // vertical line spanning both rows would visually suggest it moves both rows' cards together,
  // which is no longer true.
  rowTopPercent?: number;
  rowHeightPercent?: number;
}

function SplitterHandle({ axis, positionPercent, onMove, onEnd, ariaLabel, rowTopPercent, rowHeightPercent }: HandleProps) {
  const dragHandlers = useGridSplitter({ getContainer: getGrid, axis, onMove, onEnd });
  // Pure visual overlay, not real grid content -- position: absolute against the grid container
  // (made position: relative in index.css) rather than participating in grid placement, since
  // mixing percentage top/left with grid-row/grid-column placement doesn't compose the way you'd
  // want here.
  const style: React.CSSProperties =
    axis === "x"
      ? {
          position: "absolute",
          left: `${positionPercent}%`,
          top: rowTopPercent != null ? `${rowTopPercent}%` : 0,
          height: rowHeightPercent != null ? `${rowHeightPercent}%` : undefined,
          bottom: rowHeightPercent != null ? undefined : 0,
          width: 44,
          marginLeft: -22,
        }
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
          positionPercent={layout.row1ColSplitLeft}
          rowTopPercent={0}
          rowHeightPercent={layout.rowSplit}
          onMove={(fraction) => applyLive({ row1ColSplitLeft: fraction * 100 })}
          onEnd={commit}
          ariaLabel="Resize Location/Conditions column"
        />
        <SplitterHandle
          axis="x"
          positionPercent={layout.row1ColSplitRight}
          rowTopPercent={0}
          rowHeightPercent={layout.rowSplit}
          onMove={(fraction) => applyLive({ row1ColSplitRight: fraction * 100 })}
          onEnd={commit}
          ariaLabel="Resize Conditions/Wind column"
        />
        <SplitterHandle
          axis="x"
          positionPercent={layout.row2ColSplitLeft}
          rowTopPercent={layout.rowSplit}
          rowHeightPercent={100 - layout.rowSplit}
          onMove={(fraction) => applyLive({ row2ColSplitLeft: fraction * 100 })}
          onEnd={commit}
          ariaLabel="Resize Alerts/Map column"
        />
        <SplitterHandle
          axis="x"
          positionPercent={layout.row2ColSplitRight}
          rowTopPercent={layout.rowSplit}
          rowHeightPercent={100 - layout.rowSplit}
          onMove={(fraction) => applyLive({ row2ColSplitRight: fraction * 100 })}
          onEnd={commit}
          ariaLabel="Resize Map/Nearby column"
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
