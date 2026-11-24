export type AxivestraDeviceKind = "browser" | "desktop" | "mobile" | "guest";
export type AxivestraDeviceStatus = "pending" | "approved" | "rejected" | "revoked" | "unregistered" | "account_mismatch";

const DEVICE_STORAGE_KEY = "axivestra.access.device.v1";

export function getAxivestraDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing && /^[a-f0-9]{64}$/i.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(DEVICE_STORAGE_KEY, value);
  return value;
}

function deviceKind(): AxivestraDeviceKind {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
  if (/Electron/i.test(ua)) return "desktop";
  return "browser";
}

async function request<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const deviceId = getAxivestraDeviceId();
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-axivestra-device": deviceId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "AXIVESTRA access service returned " + response.status);
  return data;
}

export async function registerAxivestraDevice(label?: string) {
  return request<{ status: AxivestraDeviceStatus; deviceRecordId: string }>(
    "/api/access/register-device", "POST",
    { deviceId: getAxivestraDeviceId(), label: (label || navigator.userAgent).slice(0, 100), kind: deviceKind() }
  );
}

export async function getAxivestraDeviceStatus() {
  return request<{ status: AxivestraDeviceStatus; authenticated: boolean; user: { email: string; name?: string } | null }>("/api/access/status");
}

export async function checkAxivestraDeviceAccess() {
  return request<{ allowed: boolean; guest: boolean; user: { id: string; email: string } | null }>("/api/access/check");
}
