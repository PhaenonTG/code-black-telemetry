import { getPlatformCapabilities } from "./platformCapabilities";

export type OperationalNotificationKind = "chase-tracking" | "alert" | "system";

export interface OperationalNotificationStatus {
  supported: boolean;
  permission: "granted" | "denied" | "unknown" | "unsupported";
}

export interface OperationalNotificationRequest {
  kind: OperationalNotificationKind;
  title: string;
  body: string;
}

export async function getOperationalNotificationStatus(): Promise<OperationalNotificationStatus> {
  const capabilities = getPlatformCapabilities();
  if (!capabilities.notifications) return { supported: false, permission: "unsupported" };
  if (typeof Notification === "undefined") return { supported: true, permission: "unknown" };
  return { supported: true, permission: Notification.permission as OperationalNotificationStatus["permission"] };
}

export async function requestOperationalNotificationPermission() {
  if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
    return getOperationalNotificationStatus();
  }
  const permission = await Notification.requestPermission();
  return { supported: true, permission: permission as OperationalNotificationStatus["permission"] };
}

export async function postOperationalNotification(request: OperationalNotificationRequest) {
  const status = await getOperationalNotificationStatus();
  if (!status.supported || status.permission !== "granted" || typeof Notification === "undefined") return status;
  new Notification(request.title, { body: request.body, tag: request.kind });
  return status;
}
