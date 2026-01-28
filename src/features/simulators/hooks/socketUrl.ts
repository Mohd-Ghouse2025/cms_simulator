'use client';

let warnedMissingAuth = false;

const trimBasePath = (value: string) => value.replace(/\/+$/, "");

export const buildSimulatorSocketUrl = (
  baseUrl: string,
  chargerId: string,
  token?: string | null,
  tenantSchema?: string | null
): string | null => {
  if (!baseUrl) {
    return null;
  }
  if (!token || !tenantSchema) {
    if (process.env.NODE_ENV !== "production") {
      if (!warnedMissingAuth) {
        console.warn("[simulator-socket] missing token or tenant schema; skipping websocket connection");
        warnedMissingAuth = true;
      }
    }
    return null;
  }
  warnedMissingAuth = false;
  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const basePath = trimBasePath(url.pathname);
    url.pathname = `${basePath}/ws/ocpp-sim/${encodeURIComponent(chargerId)}/`;
    const params = new URLSearchParams();
    params.set("tenant_schema", tenantSchema);
    params.set("token", token);
    const query = params.toString();
    url.search = query ? `?${query}` : "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};
