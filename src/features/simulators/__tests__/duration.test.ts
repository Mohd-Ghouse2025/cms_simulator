import { describe, expect, it } from "vitest";
import { formatDurationLabel } from "../detail/detailHelpers";

describe("formatDurationLabel", () => {
  it("returns elapsed time using startedAt and nowTs", () => {
    const start = "2026-02-18T10:00:00Z";
    const now = new Date(start).getTime() + 5_000;
    const label = formatDurationLabel({ startedAt: start, completedAt: null, nowTs: now });
    expect(label).toBe("00:00:05");
  });

  it("uses cmsDurationSeconds when start missing", () => {
    const now = Date.UTC(2026, 1, 18, 12, 0, 0);
    const label = formatDurationLabel({ startedAt: null, completedAt: null, nowTs: now, cmsDurationSeconds: 120 });
    expect(label).toBe("00:02:00");
  });

  it("clamps future start to end to avoid negative span", () => {
    const end = Date.UTC(2026, 1, 18, 12, 0, 0);
    const futureStart = new Date(end + 10_000).toISOString();
    const label = formatDurationLabel({ startedAt: futureStart, completedAt: null, nowTs: end });
    expect(label).toBe("00:00:00");
  });

  it("clamps large future skew but still shows zero duration", () => {
    const end = Date.UTC(2026, 1, 18, 12, 0, 0);
    const futureStart = new Date(end + 120_000).toISOString();
    const label = formatDurationLabel({ startedAt: futureStart, completedAt: null, nowTs: end });
    expect(label).toBe("00:00:00");
  });
});
