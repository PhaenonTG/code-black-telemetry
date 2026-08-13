import { useEffect, useState } from "react";
import { Device, type DeviceInfo } from "@capacitor/device";

export interface DeviceLabels {
  device: string;
  gps: string;
  standaloneMode: string;
  standaloneNote: string;
  battery: string;
  deniedGps: string;
}

const DEFAULT_DEVICE_LABELS: DeviceLabels = {
  device: "Device",
  gps: "Internal GPS",
  standaloneMode: "STANDALONE DEVICE",
  standaloneNote: "Not configured - running from this device.",
  battery: "Device battery",
  deniedGps: "Internal GPS denied. Holding last valid source.",
};

function titleCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "";
}

export function labelsFromDeviceInfo(info: Partial<DeviceInfo> | null | undefined): DeviceLabels {
  const platform = info?.platform ?? "web";
  const model = info?.model ?? "";
  const manufacturer = info?.manufacturer ?? "";
  const lowerModel = model.toLowerCase();
  const lowerMaker = manufacturer.toLowerCase();
  let device = "Device";

  if (platform === "ios") {
    device = lowerModel.includes("ipad") ? "iPad" : lowerModel.includes("iphone") ? "iPhone" : "iOS Device";
  } else if (platform === "android") {
    if (lowerMaker.includes("samsung") || lowerModel.includes("galaxy")) {
      device = "Galaxy";
    } else if (lowerModel.includes("pixel")) {
      device = "Pixel";
    } else {
      device = titleCase(manufacturer) || "Android Device";
    }
  } else if (platform === "web") {
    device = "Browser";
  }

  const gps = device === "Browser" || device === "Device" ? "Internal GPS" : `${device} GPS`;
  return {
    device,
    gps,
    standaloneMode: `STANDALONE ${device.toUpperCase()}`,
    standaloneNote: `Not configured - running from this ${device.toLowerCase()}.`,
    battery: `${device} battery`,
    deniedGps: `${gps} denied. Holding last valid source.`,
  };
}

export function useDeviceLabels() {
  const [labels, setLabels] = useState<DeviceLabels>(() => {
    const fallbackPlatform = /iphone|ipad|ipod/i.test(navigator.userAgent)
      ? "ios"
      : /android/i.test(navigator.userAgent)
        ? "android"
        : "web";
    return labelsFromDeviceInfo({ platform: fallbackPlatform, model: navigator.userAgent, manufacturer: "" });
  });

  useEffect(() => {
    let cancelled = false;
    void Device.getInfo()
      .then((info) => {
        if (!cancelled) setLabels(labelsFromDeviceInfo(info));
      })
      .catch(() => {
        if (!cancelled) setLabels(DEFAULT_DEVICE_LABELS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return labels;
}
