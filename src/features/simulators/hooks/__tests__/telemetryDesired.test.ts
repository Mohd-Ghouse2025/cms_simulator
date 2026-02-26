import { describe, it, expect } from "vitest";
import { shouldConnectTelemetry, shouldReleaseDisconnectHold } from "../useSimulatorTelemetry";

describe("telemetry desired with disconnect hold", () => {
  it("forces disconnect when hold/suppressed even if cms is connected", () => {
    const desired = shouldConnectTelemetry({
      cmsConnected: true,
      lifecycleState: "CONNECTED",
      telemetrySuppressed: true
    });
    expect(desired).toBe(false);
  });

  it("releases hold when cms_present is false", () => {
    const release = shouldReleaseDisconnectHold({
      cmsConnected: false,
      lifecycleState: "CONNECTED"
    });
    expect(release).toBe(true);
  });

  it("releases hold on safe lifecycle states", () => {
    const release = shouldReleaseDisconnectHold({
      cmsConnected: true,
      lifecycleState: "POWERED_ON"
    });
    expect(release).toBe(true);
  });

  it("keeps hold while connected and cms present", () => {
    const release = shouldReleaseDisconnectHold({
      cmsConnected: true,
      lifecycleState: "CONNECTED"
    });
    expect(release).toBe(false);
  });
});
