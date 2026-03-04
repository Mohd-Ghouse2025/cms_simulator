import { describe, expect, it } from "vitest";

import { normalizeLifecycleState } from "./simulatorLifecycle";

const transitional = ["PREPARING", "CHARGING", "SUSPENDEDEV", "SUSPENDEDEVSE", "FINISHING", "CONNECTING", "POWERED_ON"];
const shouldPoll = (state?: string | null) => transitional.includes(normalizeLifecycleState(state) ?? "");

describe("normalizeLifecycleState", () => {
  it("normalizes whitespace, hyphens, and casing", () => {
    expect(normalizeLifecycleState(" Preparing ")).toBe("PREPARING");
    expect(normalizeLifecycleState("suspended ev")).toBe("SUSPENDEDEV");
    expect(normalizeLifecycleState("Suspended-EVSE")).toBe("SUSPENDEDEVSE");
    expect(normalizeLifecycleState("finishing")).toBe("FINISHING");
  });

  it("drives polling for transitional states", () => {
    expect(shouldPoll("Preparing")).toBe(true);
    expect(shouldPoll("SuspendedEV")).toBe(true);
    expect(shouldPoll("Suspended EVSE")).toBe(true);
    expect(shouldPoll("Finishing")).toBe(true);
    expect(shouldPoll("Offline")).toBe(false);
  });
});
