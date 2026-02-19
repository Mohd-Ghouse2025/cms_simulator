import { describe, it, expect } from "vitest";
import { resolveConnectorSelection } from "./selection";

describe("resolveConnectorSelection", () => {
  it("prefers active/preferred connector when user has not selected", () => {
    const next = resolveConnectorSelection({
      preferredConnectorId: 2,
      selectedConnectorId: 1,
      validConnectorIds: [1, 2],
      userHasSelected: false
    });
    expect(next).toBe(2);
  });

  it("keeps user selection when userHasSelected is true", () => {
    const next = resolveConnectorSelection({
      preferredConnectorId: 2,
      selectedConnectorId: 1,
      validConnectorIds: [1, 2],
      userHasSelected: true
    });
    expect(next).toBe(1);
  });

  it("falls back to first valid connector when none selected", () => {
    const next = resolveConnectorSelection({
      preferredConnectorId: null,
      selectedConnectorId: null,
      validConnectorIds: [3, 4],
      userHasSelected: false
    });
    expect(next).toBe(3);
  });
});
