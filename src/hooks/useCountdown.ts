import { useEffect, useState } from "react";
import { timeRemainingText } from "../services/situational";

// Ticks on an interval while mounted so an "Expires in X min" string stays live instead of
// freezing at whatever value it had when the component last rendered for an unrelated reason.
export function useCountdown(expiresIso: string, intervalMs = 30_000): string {
  const [text, setText] = useState(() => timeRemainingText(expiresIso));

  useEffect(() => {
    setText(timeRemainingText(expiresIso));
    if (!expiresIso) return;
    const id = setInterval(() => setText(timeRemainingText(expiresIso)), intervalMs);
    return () => clearInterval(id);
  }, [expiresIso, intervalMs]);

  return text;
}
