'use client';

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
  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const basePath = trimBasePath(url.pathname);
    url.pathname = `${basePath}/ws/ocpp-sim/${encodeURIComponent(chargerId)}/`;
    const params = new URLSearchParams();
    if (tenantSchema) {
      params.set("tenant_schema", tenantSchema);
    }
    if (token) {
      params.set("token", token);
    }
    const query = params.toString();
    url.search = query ? `?${query}` : "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};
