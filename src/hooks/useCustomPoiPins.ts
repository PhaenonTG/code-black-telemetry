import { useEffect, useState } from "react";
import { getCustomPoiPins, loadCustomPoiPins, subscribeCustomPoiPins, type CustomPoiPin } from "../services/settings";

export function useCustomPoiPins(): CustomPoiPin[] {
  const [pins, setPins] = useState(() => getCustomPoiPins());
  useEffect(() => {
    const unsubscribe = subscribeCustomPoiPins(setPins);
    void loadCustomPoiPins();
    return unsubscribe;
  }, []);
  return pins;
}
