import { useEffect, useState } from "react";
import { Device, type DeviceInfo } from "@capacitor/device";

export interface DeviceLabels {
  device: string;
  gps: string;
  standaloneMode: string;
  standaloneNote: string;
  battery: string;
  deniedGps: string;
  unavailableGps: string;
}

const DEFAULT_DEVICE_LABELS: DeviceLabels = {
  device: "Device",
  gps: "Internal GPS",
  standaloneMode: "STANDALONE DEVICE",
  standaloneNote: "Not configured - running from this device.",
  battery: "Device battery",
  deniedGps: "Internal GPS denied. Holding last valid source.",
  unavailableGps: "Internal GPS unavailable. Check location permission.",
};

function titleCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "";
}

function webDeviceLabel(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipod/.test(ua)) return "iPhone";
  if (/ipad/.test(ua)) return "iPad";
  if (/android/.test(ua)) return /sm-|samsung|galaxy/.test(ua) ? "Galaxy" : "Android Device";
  if (/windows|macintosh|linux|cros/.test(ua)) return "Laptop";
  return "Browser";
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
    device = webDeviceLabel(model || (typeof navigator !== "undefined" ? navigator.userAgent : ""));
  }

  const gps = device === "Browser" || device === "Device" ? "Internal GPS" : `${device} GPS`;
  return {
    device,
    gps,
    standaloneMode: `STANDALONE ${device.toUpperCase()}`,
    standaloneNote: `Not configured - running from this ${device.toLowerCase()}.`,
    battery: `${device} battery`,
    deniedGps: `${gps} denied. Holding last valid source.`,
    unavailableGps: `${gps} unavailable. Check browser/system location permission.`,
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
