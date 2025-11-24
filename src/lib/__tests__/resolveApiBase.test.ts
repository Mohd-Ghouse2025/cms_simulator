import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { resolveApiBase } from "../resolveApiBase"

declare global {
  interface Window {
    location: Location
  }
}

const originalEnv = { ...process.env }
const originalWindow = global.window

const resetEnv = () => {
  process.env = { ...originalEnv }
  if (originalWindow) {
    global.window = originalWindow
  } else {
    // @ts-expect-error allow deleting window for tests
    delete global.window
  }
}

beforeEach(() => {
  resetEnv()
})

afterEach(() => {
  resetEnv()
})

describe("resolveApiBase", () => {
  it("builds local URL with default port", () => {
    global.window = { location: { hostname: "localhost" } } as unknown as Window & typeof globalThis
    const { apiBase, tenant } = resolveApiBase("cms")
    expect(tenant).toBe("cms")
    expect(apiBase).toBe("http://cms.localhost:8000/api")
  })

  it("honors custom local port", () => {
    process.env.NEXT_PUBLIC_LOCAL_API_PORT = "9000"
    global.window = { location: { hostname: "localhost" } } as unknown as Window & typeof globalThis
    const { apiBase } = resolveApiBase("charger-zone")
    expect(apiBase).toBe("http://charger-zone.localhost:9000/api")
  })

  it("builds remote URL when not local", () => {
    process.env.NEXT_PUBLIC_DEFAULT_ENV = "test"
    process.env.NEXT_PUBLIC_API_BASE_DOMAIN = "platform.example.com"
    process.env.NEXT_PUBLIC_API_PROTOCOL = "https"
    // @ts-expect-error allow deleting window for tests
    delete global.window
    const { apiBase } = resolveApiBase("cms")
    expect(apiBase).toBe("https://cms.platform.example.com/api")
  })

  it("uses override URL when provided", () => {
    const result = resolveApiBase("cms", "https://edge.example.com/custom")
    expect(result.apiBase).toBe("https://edge.example.com/custom")
  })

  it("rejects invalid tenant", () => {
    expect(() => resolveApiBase("!!")).toThrow()
  })

  it("validates override URL", () => {
    expect(() => resolveApiBase("cms", "not-a-url")).toThrow()
  })
})
