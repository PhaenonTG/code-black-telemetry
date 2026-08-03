import { useEffect, useState } from "react";
import {
  getChaserPinStyle,
  getTeamPinStyle,
  loadChaserPinStyle,
  loadTeamPinStyle,
  subscribeChaserPinStyle,
  subscribeTeamPinStyle,
  type PinStyle,
} from "../services/settings";

export function useTeamPinStyle(): PinStyle {
  const [style, setStyle] = useState(() => getTeamPinStyle());
  useEffect(() => {
    const unsubscribe = subscribeTeamPinStyle(setStyle);
    void loadTeamPinStyle();
    return unsubscribe;
  }, []);
  return style;
}

export function useChaserPinStyle(): PinStyle {
  const [style, setStyle] = useState(() => getChaserPinStyle());
  useEffect(() => {
    const unsubscribe = subscribeChaserPinStyle(setStyle);
    void loadChaserPinStyle();
    return unsubscribe;
  }, []);
  return style;
}
