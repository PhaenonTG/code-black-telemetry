import { useCallback, useRef } from "react";

export type SplitterAxis = "x" | "y";

interface UseGridSplitterArgs {
  // Queried fresh on every pointerdown rather than held in a ref -- the grid container is owned by
  // a different component (App.tsx/Panels.tsx render .page-grid--weather, not this hook's caller),
  // so there's no stable ref to thread through; a fresh query avoids staleness entirely.
  getContainer: () => HTMLElement | null;
  axis: SplitterAxis;
  onMove: (fraction: number) => void;
  onEnd: () => void;
}

// Pointer Events (not mouse/touch separately) so the same code path works identically for the
// Android tablet's touch input, a trackpad/mouse in the browser preview, and iPad/iPhone touch --
// this is exactly the kind of drag interaction Pointer Events were designed to unify.
export function useGridSplitter({ getContainer, axis, onMove, onEnd }: UseGridSplitterArgs) {
  const rectRef = useRef<DOMRect | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = getContainer();
      if (!container) return;
      event.preventDefault();
      rectRef.current = container.getBoundingClientRect();
      // setPointerCapture keeps the drag alive even if the finger/cursor moves off the thin
      // handle mid-drag -- important on a moving vehicle where a perfectly steady touch isn't
      // realistic.
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [getContainer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = rectRef.current;
      if (!rect) return;
      const fraction = axis === "x" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
      onMove(Math.min(1, Math.max(0, fraction)));
    },
    [axis, onMove],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!rectRef.current) return;
      rectRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onEnd();
    },
    [onEnd],
  );

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
