const trimAll = (value: string) => value.trim().replace(/\/+$/, "")

const stripTrailingApi = (value: string) => {
  const normalized = trimAll(value)
  if (!normalized) {
    return ""
  }
  return normalized.replace(/\/api$/i, "")
}

export const normalizeApiBase = (value: string) => stripTrailingApi(value)

export const tenantRootFromApi = (apiBase: string) => stripTrailingApi(apiBase)
