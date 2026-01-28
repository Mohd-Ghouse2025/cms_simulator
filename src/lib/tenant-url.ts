const trimAll = (value: string) => value.trim().replace(/\/+$/, "");

const stripTrailingApi = (value: string) => {
  const normalized = trimAll(value);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\/api$/i, "");
};

const normalizeProtocol = (value: string) => {
  const trimmed = trimAll(value);
  if (!trimmed) {
    return "";
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const isLocalHost =
      host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
    if (isLocalHost && url.protocol === "https:") {
      url.protocol = "http:";
    }
    return trimAll(url.toString());
  } catch {
    return trimmed;
  }
};

export const normalizeApiBase = (value: string) => normalizeProtocol(stripTrailingApi(value));

export const tenantRootFromApi = (apiBase: string) => normalizeProtocol(stripTrailingApi(apiBase));
