import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { _SimulatorRowTestOnly as SimulatorRow } from "../SimulatorsPage";
import { SimulatedCharger, SimulatorInstance } from "@/types";

describe("SimulatorsPage runtime gating", () => {
  it("enables Power On when running instance heartbeat is stale", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const staleHeartbeat = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const simulator: SimulatedCharger = {
      id: 1,
      charger: 1,
      charger_id: "SIM-1",
      alias: "Sim One",
      protocol_variant: "1.6j",
      require_tls: false,
      allowed_cidrs: [],
      default_heartbeat_interval: 60,
      default_meter_value_interval: 60,
      default_status_interval: 60,
      lifecycle_state: "OFFLINE",
      latest_instance_status: "running",
      latest_instance_last_heartbeat: staleHeartbeat,
      simulator_version: "",
      firmware_baseline: "",
      ocpp_capabilities: [],
      notes: "",
      connectors: [],
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      smart_charging_profile: {},
      telemetrySnapshot: null,
      telemetryHistory: null,
      cms_online: false,
      cms_present: false,
      cms_last_heartbeat: null,
      price_per_kwh: null
    };

    const instance: SimulatorInstance = {
      id: 10,
      sim: simulator.id,
      status: "running",
      protocol_driver: "1.6j",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      started_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      last_heartbeat: staleHeartbeat,
      celery_queue: "",
      worker_hostname: "",
      process_id: null,
      runtime_pidfile: null
    };

    render(
      <table>
        <tbody>
          <SimulatorRow
            simulator={simulator}
            rowIndex={1}
            instance={instance}
            cmsOnline={false}
            busyAction={null}
            performAction={() => undefined}
            router={{ push: vi.fn() } as any}
          />
        </tbody>
      </table>
    );

    const powerButton = screen.getByRole("button", { name: /Power On/i });
    expect(powerButton).toBeEnabled();

    vi.useRealTimers();
  });
});
