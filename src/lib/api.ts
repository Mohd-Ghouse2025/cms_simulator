export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export type TokenSet = {
  access: string;
  refresh?: string;
};

export type RequestConfig = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  responseType?: "json" | "text" | "blob";
};

export type RefreshHandler = () => Promise<TokenSet | null>;
export type LogoutReason = "manual" | "expired" | "forbidden";
export type LogoutHandler = (options?: { redirect?: boolean; reason?: LogoutReason }) => void;

const extractDetailMessage = (data: unknown): string | null => {
  if (!data || typeof data !== "object") {
    return null;
  }
  if ("detail" in data && typeof (data as Record<string, unknown>).detail === "string") {
    return String((data as Record<string, unknown>).detail);
  }
  if ("message" in data && typeof (data as Record<string, unknown>).message === "string") {
    return String((data as Record<string, unknown>).message);
  }
  return null;
};

const isAuthenticationDetail = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not authenticated") ||
    normalized.includes("credentials") ||
    normalized.includes("token") ||
    normalized.includes("jwt")
  );
};

export class TenantApiClient {
  private baseUrl: string;
  private tokens: TokenSet | null;
  private onRefresh: RefreshHandler;
  private onLogout: LogoutHandler;

  constructor(
    baseUrl: string,
    tokens: TokenSet | null,
    onRefresh: RefreshHandler,
    onLogout: LogoutHandler
  ) {
    this.baseUrl = baseUrl;
    this.tokens = tokens;
    this.onRefresh = onRefresh;
    this.onLogout = onLogout;
  }

  updateTokens(tokens: TokenSet | null) {
    this.tokens = tokens;
  }

  async request<T>(path: string, config: RequestConfig = {}): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("Tenant base URL is not configured");
    }

    const url = this.buildUrl(path, config.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...config.headers
    };

    if (this.tokens?.access) {
      headers.Authorization = `Bearer ${this.tokens.access}`;
    }

    const response = await fetch(url, {
      method: config.method ?? "GET",
      headers,
      body:
        config.body === undefined ? undefined : JSON.stringify(config.body),
      signal: config.signal
    });

    const isUnauthorized = response.status === 401 || response.status === 403;
    if (isUnauthorized) {
      if (response.status === 401 && this.tokens?.refresh) {
        const refreshed = await this.onRefresh();
        if (refreshed) {
          this.tokens = refreshed;
          return this.request(path, config);
        }
      }
      this.onLogout({ reason: "expired" });
      throw new ApiError("Session expired", response.status, null);
    }

    if (!response.ok) {
      let data: unknown = null;
      let detailMessage: string | null = null;
      try {
        data = await response.json();
        detailMessage = extractDetailMessage(data);
      } catch {
        detailMessage = null;
      }
      if (detailMessage && isAuthenticationDetail(detailMessage)) {
        this.onLogout({ reason: "expired" });
        throw new ApiError("Session expired", response.status, data);
      }
      throw new ApiError(detailMessage ?? "Request failed", response.status, data);
    }

    const responseType = config.responseType ?? "json";

    if (response.status === 204 || response.status === 202) {
      return undefined as T;
    }

    if (responseType === "text") {
      return (await response.text()) as T;
    }

    if (responseType === "blob") {
      return (await response.blob()) as T;
    }

    return (await response.json()) as T;
  }

  private buildUrl(
    path: string,
    params?: RequestConfig["query"]
  ): string {
    const sanitizedBase = this.baseUrl
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/api$/i, "");
    const normalizedPath = path.startsWith("http")
      ? path
      : `${sanitizedBase}/${path.replace(/^\//, "")}`;
    if (!params) {
      return normalizedPath;
    }
    const url = new URL(normalizedPath);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  }
}
