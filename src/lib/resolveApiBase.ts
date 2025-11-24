const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export const sanitizeTenant = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export const validateTenant = (value: string): string => {
  const sanitized = sanitizeTenant(value)
  if (!sanitized || sanitized.length < 2 || sanitized.length > 63 || !TENANT_PATTERN.test(sanitized)) {
    throw new Error("Tenant name must be 2–63 chars (letters, numbers, hyphen)")
  }
  return sanitized
}

const isBrowserLocalhost = () => {
  if (typeof window === "undefined") {
    return false
  }
  const hostname = window.location.hostname
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost")
}

export type ApiEnvironment = "local" | "remote"

export const isLocalEnvironment = () => {
  const envFlag = process.env.NEXT_PUBLIC_DEFAULT_ENV
  if (envFlag) {
    return envFlag.toLowerCase() === "local"
  }
  return isBrowserLocalhost()
}

export const getDefaultApiEnvironment = (): ApiEnvironment => (isLocalEnvironment() ? "local" : "remote")

export type ResolveApiBaseResult = {
  apiBase: string
  tenant: string
}

const getLocalApiBase = (tenant: string) => {
  const localPort = process.env.NEXT_PUBLIC_LOCAL_API_PORT ?? "8000"
  return `http://${tenant}.localhost:${localPort}/api`
}

const getRemoteApiBase = (tenant: string) => {
  const domain = process.env.NEXT_PUBLIC_API_BASE_DOMAIN ?? "platform-api-test.joulepoint.com"
  const remoteProtocol = (process.env.NEXT_PUBLIC_API_PROTOCOL ?? "https").replace(/:$/, "")
  return `${remoteProtocol}://${tenant}.${domain}/api`
}

const buildApiBase = (tenant: string, environment: ApiEnvironment) =>
  environment === "local" ? getLocalApiBase(tenant) : getRemoteApiBase(tenant)

export const resolveApiBase = (
  tenantInput: string,
  override?: string,
  environment?: ApiEnvironment
): ResolveApiBaseResult => {
  const tenant = validateTenant(tenantInput)
  if (override && override.trim().length > 0) {
    const overrideUrl = override.trim()
    try {
      const url = new URL(overrideUrl)
      return { apiBase: url.toString().replace(/\/$/, ""), tenant }
    } catch {
      throw new Error("Override URL must be a valid absolute URL")
    }
  }

  const selectedEnvironment = environment ?? getDefaultApiEnvironment()
  const apiBase = buildApiBase(tenant, selectedEnvironment)
  return { apiBase, tenant }
}
