'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { TokenSet, LogoutReason } from "@/lib/api";
import { normalizeApiBase, tenantRootFromApi } from "@/lib/tenant-url";
import { sanitizeTenant } from "@/lib/resolveApiBase";
import {
  clearSessionExpiryCookie,
  rememberLastTenantCookie,
  writeSessionExpiryCookie
} from "@/lib/authCookies";
import { useNotificationStore } from "@/store/notificationStore";

type TenantProfile = {
  name: string;
  email: string;
  tenant: string;
  initials: string;
};

type TenantSession = {
  baseUrl: string;
  tokens: TokenSet;
  profile: TenantProfile;
  tenant?: string;
};

type AuthResponse = {
  access?: string;
  refresh?: string;
  access_token?: string;
  refresh_token?: string;
  user?: {
    email?: string;
    name?: string;
  };
};

type LoginParams = {
  baseUrl: string;
  tenant?: string;
  username: string;
  password: string;
  rememberTenant?: boolean;
};

type LogoutOptions = {
  redirect?: boolean;
  reason?: LogoutReason;
};

type TenantAuthContextValue = {
  baseUrl: string;
  tokens: TokenSet | null;
  profile: TenantProfile | null;
  isAuthenticated: boolean;
  hydrated: boolean;
  tenant?: string | null;
  login: (params: LoginParams) => Promise<void>;
  logout: (options?: LogoutOptions) => void;
  refreshTokens: () => Promise<TokenSet | null>;
  setBaseUrl: (url: string) => void;
  rememberedTenants: string[];
};

const STORAGE_KEY = "ocpp-simulator-session";
const TENANT_CACHE_KEY = "ocpp-remembered-tenants";

const TenantAuthContext = createContext<TenantAuthContextValue | undefined>(undefined);

const decodeJwtExpiry = (token?: string | null): number | null => {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const payload = parts[1];
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
};

const isAccessTokenExpired = (token?: string | null, skewSeconds = 30) => {
  const expiry = decodeJwtExpiry(token);
  if (!expiry) {
    return false;
  }
  const nowSeconds = Date.now() / 1000;
  return expiry - nowSeconds <= skewSeconds;
};

const toInitials = (value: string) => {
  const parts = value.split(" ");
  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`.toUpperCase();
  }
  return value
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();
};

const mapAuthResponseToTokens = (data: AuthResponse, fallbackRefresh?: string): TokenSet | null => {
  const accessToken = data?.access ?? data?.access_token;
  const refreshToken = data?.refresh ?? data?.refresh_token ?? fallbackRefresh;
  if (!accessToken) {
    return null;
  }
  return { access: accessToken, refresh: refreshToken };
};

export const TenantAuthProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pushToast = useNotificationStore((state) => state.pushToast);
  const clearToasts = useNotificationStore((state) => state.clear);
  const forcedLogoutRef = useRef(false);
  const [baseUrl, setBaseUrlState] = useState("");
  const [tokens, setTokens] = useState<TokenSet | null>(null);
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [rememberedTenants, setRememberedTenants] = useState<string[]>([]);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const persistSession = useCallback(
    (session: TenantSession | null) => {
      if (typeof window === "undefined") {
        return;
      }
      if (!session) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const normalizedBase = normalizeApiBase(session.baseUrl);
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...session, baseUrl: normalizedBase })
      );
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const session: TenantSession = JSON.parse(stored);
        const normalized = normalizeApiBase(session.baseUrl);
        setBaseUrlState(normalized);
        setTokens(session.tokens);
        setProfile(session.profile);
        setTenantSlug(session.tenant ?? null);
        const expiry = decodeJwtExpiry(session.tokens.access);
        writeSessionExpiryCookie(expiry);
        if (session.tenant) {
          rememberLastTenantCookie(session.tenant);
        }
        if (normalized !== session.baseUrl) {
          const updated: TenantSession = { ...session, baseUrl: normalized };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        }
      }
      const cached = window.localStorage.getItem(TENANT_CACHE_KEY);
      if (cached) {
        const entries: string[] = JSON.parse(cached);
        const normalizedEntries = entries
          .map((tenant) => {
            if (!tenant) {
              return "";
            }
            if (tenant.startsWith("http")) {
              try {
                const host = new URL(tenant).hostname.split(".")[0] ?? "";
                return sanitizeTenant(host);
              } catch {
                return "";
              }
            }
            return sanitizeTenant(tenant);
          })
          .filter(Boolean);
        setRememberedTenants(normalizedEntries);
        window.localStorage.setItem(
          TENANT_CACHE_KEY,
          JSON.stringify(normalizedEntries)
        );
      }
    } catch (error) {
      console.warn("Failed to hydrate session", error);
    } finally {
      setHydrated(true);
    }
  }, [persistSession]);

  const addRememberedTenant = useCallback((tenantSlug: string) => {
    if (typeof window === "undefined") {
      return;
    }
    const normalized = sanitizeTenant(tenantSlug);
    if (!normalized) {
      return;
    }
    setRememberedTenants((prev) => {
      const next = Array.from(new Set([normalized, ...prev])).slice(0, 5);
      window.localStorage.setItem(TENANT_CACHE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(
    (options?: LogoutOptions) => {
      const reason: LogoutReason = options?.reason ?? "manual";
      if (reason === "expired") {
        if (forcedLogoutRef.current) {
          return;
        }
        forcedLogoutRef.current = true;
      } else {
        forcedLogoutRef.current = false;
      }
      const lastTenant = tenantSlug;
      setTokens(null);
      setProfile(null);
      setTenantSlug(null);
      persistSession(null);
      clearSessionExpiryCookie();
      queryClient.clear();
      clearToasts();
      if (lastTenant) {
        rememberLastTenantCookie(lastTenant);
      }
      if (reason === "expired") {
        pushToast({
          title: "Session expired — please login again.",
          level: "warning",
          timeoutMs: 5000
        });
      }
      if (options?.redirect === false) {
        return;
      }
      router.push("/login");
    },
    [clearToasts, persistSession, pushToast, queryClient, router, tenantSlug]
  );

  const refreshTokens = useCallback(async () => {
    if (!baseUrl || !tokens?.refresh) {
      return null;
    }
    const apiBase = baseUrl.replace(/\/$/, "");
    const tenantRoot = tenantRootFromApi(apiBase);
    let response: Response | null = null;
    try {
      response = await fetch(`${tenantRoot}/api/users/refresh_token/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh: tokens.refresh }),
      });
    } catch (error) {
      console.warn("Refresh token request failed", error);
      logout({ reason: "expired" });
      return null;
    }
    if (!response.ok) {
      logout({ reason: "expired" });
      return null;
    }
    const data = (await response.json()) as AuthResponse;
    const nextTokens = mapAuthResponseToTokens(data, tokens.refresh);
    if (!nextTokens) {
      logout({ reason: "expired" });
      return null;
    }
    setTokens(nextTokens);
    if (profile) {
      persistSession({ baseUrl: apiBase, tokens: nextTokens, profile, tenant: tenantSlug ?? undefined });
    }
    const expiry = decodeJwtExpiry(nextTokens.access);
    writeSessionExpiryCookie(expiry);
    if (tenantSlug) {
      rememberLastTenantCookie(tenantSlug);
    }
    return nextTokens;
  }, [baseUrl, tokens, logout, profile, persistSession, tenantSlug]);

  const login = useCallback(
    async ({ baseUrl: tenantUrl, username, password, rememberTenant, tenant }: LoginParams) => {
      const normalizedBase = normalizeApiBase(tenantUrl);
      setBaseUrlState(normalizedBase);
      if (tenant) {
        setTenantSlug(tenant);
      }

      const tenantRoot = tenantRootFromApi(normalizedBase);

      let healthResponse: Response;
      try {
        healthResponse = await fetch(`${tenantRoot}/api/health/`);
      } catch (error) {
        console.warn("Tenant health check failed", error);
        throw new Error("Unable to reach tenant API");
      }
      if (!healthResponse.ok) {
        throw new Error("Tenant health check failed");
      }

      let tokenResponse: Response;
      try {
        tokenResponse = await fetch(`${tenantRoot}/api/users/login_with_password/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username, password, tenant_code: tenant }),
        });
      } catch (error) {
        console.warn("Token request failed", error);
        throw new Error("Unable to reach tenant API");
      }

      if (!tokenResponse.ok) {
        let detail: string | undefined;
        try {
          const json = await tokenResponse.json();
          detail = json.detail ?? json.error ?? json.message;
        } catch {
          try {
            detail = await tokenResponse.text();
          } catch {
            detail = undefined;
          }
        }
        throw new Error(detail || "Authentication failed");
      }

      const tokenData = (await tokenResponse.json()) as AuthResponse;
      const nextTokens = mapAuthResponseToTokens(tokenData);
      if (!nextTokens) {
        throw new Error("No access token returned from login_with_password");
      }
      const tenantHost = new URL(tenantRoot).host;
      const derivedName = username.split("@")[0] ?? username;

      const nextProfile: TenantProfile = {
        name: derivedName.replace(/[._-]/g, " "),
        email: username,
        tenant: tenantHost,
        initials: toInitials(derivedName),
      };

      const session: TenantSession = {
        baseUrl: normalizedBase,
        tokens: nextTokens,
        profile: nextProfile,
        tenant,
      };

      setTokens(nextTokens);
      setProfile(nextProfile);
      setTenantSlug(tenant ?? null);
      persistSession(session);
      const expiry = decodeJwtExpiry(nextTokens.access);
      writeSessionExpiryCookie(expiry);
      if (tenant) {
        rememberLastTenantCookie(tenant);
      }
      forcedLogoutRef.current = false;

      if (rememberTenant) {
        if (tenant) {
          addRememberedTenant(tenant);
        }
      }
    },
    [addRememberedTenant, persistSession]
  );

  useEffect(() => {
    if (!tokens?.access || !tokens.refresh) {
      return;
    }
    if (isAccessTokenExpired(tokens.access)) {
      void refreshTokens();
      return;
    }
    const expiry = decodeJwtExpiry(tokens.access);
    if (!expiry) {
      return;
    }
    const refreshLeadMs = 30_000;
    const delay = Math.max(expiry * 1000 - Date.now() - refreshLeadMs, refreshLeadMs);
    const timer = window.setTimeout(() => {
      void refreshTokens();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [tokens?.access, tokens?.refresh, refreshTokens]);

  const value = useMemo<TenantAuthContextValue>(
    () => ({
      baseUrl,
      tokens,
      profile,
      hydrated,
      tenant: tenantSlug,
      isAuthenticated: Boolean(tokens?.access && profile),
      login,
      logout,
      refreshTokens,
      setBaseUrl: (url: string) => setBaseUrlState(normalizeApiBase(url)),
      rememberedTenants
    }),
    [
      baseUrl,
      tokens,
      profile,
      hydrated,
      tenantSlug,
      login,
      logout,
      refreshTokens,
      rememberedTenants
    ]
  );

  return (
    <TenantAuthContext.Provider value={value}>
      {children}
    </TenantAuthContext.Provider>
  );
};

export const useTenantAuthContext = () => {
  const context = useContext(TenantAuthContext);
  if (!context) {
    throw new Error("useTenantAuthContext must be used within TenantAuthProvider");
  }
  return context;
};
