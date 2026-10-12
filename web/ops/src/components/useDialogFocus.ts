import { useEffect, useRef, type RefObject } from "react"

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, modal = true) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current
    root?.focus()
    const controls = () => [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], [tabindex="0"]') ?? [])]
      .filter((element) => element.tabIndex >= 0 && !element.closest("[hidden], [inert]") && element.getClientRects().length > 0)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return }
      if (!modal || event.key !== "Tab") return
      const items = controls(), first = items[0], last = items[items.length - 1]
      if (!first) { event.preventDefault(); root?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus() }
    }
    const keepFocus = (event: FocusEvent) => { if (modal && root && !root.contains(event.target as Node)) root.focus() }
    window.addEventListener("keydown", onKey)
    document.addEventListener("focusin", keepFocus)
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("focusin", keepFocus); if (previous?.isConnected) previous.focus() }
  }, [ref, modal])
}
