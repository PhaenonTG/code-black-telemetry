import { useEffect, useState } from "react";
import {
  getChaserPinStyle,
  getTeamPinStyle,
  getVehicleMarkerStyle,
  loadChaserPinStyle,
  loadTeamPinStyle,
  loadVehicleMarkerStyle,
  subscribeChaserPinStyle,
  subscribeTeamPinStyle,
  subscribeVehicleMarkerStyle,
  type PinStyle,
  type VehicleMarkerStyle,
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

export function useVehicleMarkerStyle(): VehicleMarkerStyle {
  const [style, setStyle] = useState(() => getVehicleMarkerStyle());
  useEffect(() => {
    const unsubscribe = subscribeVehicleMarkerStyle(setStyle);
    void loadVehicleMarkerStyle();
    return unsubscribe;
  }, []);
  return style;
}
