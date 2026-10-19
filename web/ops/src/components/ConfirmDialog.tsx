import { useId, useLayoutEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import "./ConfirmDialog.css"

type Props = {
  title: string
  consequence: string
  onCancel: () => void
  children: ReactNode
}

// Mounted only while open. The portal keeps the modal outside workspace layout rules.
export default function ConfirmDialog({ title, consequence, onCancel, children }: Props) {
  const id = useId()
  const panel = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = panel.current!
    const cancelButton = cancel.current!
    dialog.showModal()
    cancelButton.focus()
    const containFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) cancelButton.focus()
    }
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled, [hidden], [inert]'))
      const current = controls.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length
      event.preventDefault()
      controls[next]?.focus()
    }
    document.addEventListener("focusin", containFocus)
    document.addEventListener("keydown", trapTab)
    return () => {
      document.removeEventListener("focusin", containFocus)
      document.removeEventListener("keydown", trapTab)
      dialog.close()
      if (opener?.isConnected) {
        opener.focus()
        // A submitted command can temporarily disable its opener while awaiting API
        // acknowledgment. Restore focus when it becomes available, unless the user
        // has already moved to another control.
        // Wait for the closing render to finish applying disabled attributes.
        queueMicrotask(() => {
          if (!opener.isConnected || !opener.matches(":disabled")) return
          const stop = () => { observer.disconnect(); document.removeEventListener("focusin", movedFocus) }
          const movedFocus = () => { if (document.activeElement !== document.body) stop() }
          const observer = new MutationObserver(() => {
            if (!opener.matches(":disabled")) {
              stop()
              if (document.activeElement === document.body && opener.isConnected) opener.focus()
            }
          })
          observer.observe(opener, { attributes: true, attributeFilter: ["disabled"] })
          document.addEventListener("focusin", movedFocus)
        })
      }
    }
  }, [])
  return createPortal(<dialog ref={panel} className="cb-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-consequence`} onCancel={event => { event.preventDefault(); onCancel() }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel() }
    }}>
      <h3 id={`${id}-title`}>{title}</h3>
      <p id={`${id}-consequence`}>{consequence}</p>
      {children}
      <button ref={cancel} type="button" onClick={onCancel}>Cancel</button>
  </dialog>, document.body)
}
