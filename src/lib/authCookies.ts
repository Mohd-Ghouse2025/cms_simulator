const SESSION_COOKIE_NAME = "ocpp_session";
const LAST_TENANT_COOKIE_NAME = "ocpp_last_tenant";

const getCookieString = () =>
  typeof document === "undefined" ? "" : document.cookie ?? "";

const buildCookieAttributes = (maxAgeSeconds?: number) => {
  const attributes = ["Path=/", "SameSite=Lax"];
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    attributes.push("Secure");
  }
  if (typeof maxAgeSeconds === "number") {
    attributes.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  return attributes.join("; ");
};

const setCookie = (name: string, value: string, maxAgeSeconds?: number) => {
  if (typeof document === "undefined") {
    return;
  }
  const encoded = encodeURIComponent(value);
  document.cookie = `${name}=${encoded}; ${buildCookieAttributes(maxAgeSeconds)}`;
};

export const writeSessionExpiryCookie = (expirySeconds: number | null | undefined) => {
  if (!expirySeconds) {
    clearSessionExpiryCookie();
    return;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxAge = Math.max(expirySeconds - nowSeconds, 60);
  setCookie(SESSION_COOKIE_NAME, String(expirySeconds), maxAge);
};

export const clearSessionExpiryCookie = () => {
  setCookie(SESSION_COOKIE_NAME, "", 0);
};

export const rememberLastTenantCookie = (tenant?: string | null) => {
  if (!tenant) {
    return;
  }
  // Keep the tenant hint for 30 days so login form can prefill.
  const thirtyDays = 60 * 60 * 24 * 30;
  setCookie(LAST_TENANT_COOKIE_NAME, tenant, thirtyDays);
};

export const readLastTenantCookie = (): string | null => {
  const cookieString = getCookieString();
  if (!cookieString) {
    return null;
  }
  const match = cookieString
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${LAST_TENANT_COOKIE_NAME}=`));
  if (!match) {
    return null;
  }
  const [, rawValue = ""] = match.split("=");
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
};

export const clearLastTenantCookie = () => {
  setCookie(LAST_TENANT_COOKIE_NAME, "", 0);
};

export const SESSION_COOKIE = SESSION_COOKIE_NAME;
export const LAST_TENANT_COOKIE = LAST_TENANT_COOKIE_NAME;
