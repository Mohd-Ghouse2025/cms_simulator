import { describe, it, expect } from "vitest";

import { normalizeApiBase, tenantRootFromApi } from "../tenant-url";

describe("tenant-url normalization", () => {
  it("strips trailing /api and normalizes localhost protocol", () => {
    expect(normalizeApiBase("http://cms.localhost:8000/api")).toBe("http://cms.localhost:8000");
    expect(normalizeApiBase("https://cms.localhost:8000/api/")).toBe("http://cms.localhost:8000");
  });

  it("adds a default protocol for bare localhost hosts", () => {
    expect(tenantRootFromApi("cms.localhost:8000/api")).toBe("http://cms.localhost:8000");
  });

  it("preserves remote HTTPS hosts", () => {
    expect(normalizeApiBase("https://tenant.example.com/api")).toBe("https://tenant.example.com");
  });
});
