import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let requestMock = vi.fn();

vi.mock("@/hooks/useTenantApi", () => ({
  useTenantApi: () => ({ request: requestMock })
}));

const pushToastMock = vi.fn();
vi.mock("@/store/notificationStore", () => ({
  useNotificationStore: (selector?: (state: { pushToast: typeof pushToastMock }) => unknown) =>
    selector ? selector({ pushToast: pushToastMock }) : { pushToast: pushToastMock }
}));

vi.mock("../../SimulatorChannelProvider", () => ({
  useSimulatorChannelContext: () => ({ setDisconnectHold: vi.fn() })
}));

import { useSimulatorCommands } from "../useSimulatorCommands";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("useSimulatorCommands.handleRemoteStart", () => {
  beforeEach(() => {
    requestMock = vi.fn();
    pushToastMock.mockReset();
  });

  const makeProps = () => ({
    simulatorId: 1,
    data: {
      id: 1,
      cms_online: true,
      cms_present: true
    } as any,
    connectorsSummary: [
      {
        connectorId: 1,
        connectorStatus: "AVAILABLE",
        sessionState: "idle",
        activeSession: false,
        connector: { initial_status: "AVAILABLE" }
      }
    ] as any,
    actionConnectorId: 1,
    activeSession: null,
    resolveConnectorNumber: () => 1,
    refreshSimulator: vi.fn(),
    patchConnectorStatus: vi.fn(),
    setResetFlow: vi.fn()
  });

  it("sets Preparing first and still surfaces RemoteStart failure", async () => {
    requestMock
      .mockResolvedValueOnce({}) // statusUpdate -> Preparing
      .mockRejectedValueOnce(new Error("fail")); // RemoteStart

    const props = makeProps();
    const { result } = renderHook(() => useSimulatorCommands(props), { wrapper });

    await act(async () => {
      await expect(
        result.current.handleRemoteStart({ connectorId: 1, idTag: "ABC" })
      ).rejects.toThrow();
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(props.patchConnectorStatus).toHaveBeenCalledWith(1, "PREPARING");
  });

  it("prepares then RemoteStart when available", async () => {
    requestMock
      .mockResolvedValueOnce({}) // statusUpdate
      .mockResolvedValueOnce({}); // RemoteStart

    const props = makeProps();
    const { result } = renderHook(() => useSimulatorCommands(props), { wrapper });

    await act(async () => {
      await result.current.handleRemoteStart({ connectorId: 1, idTag: "ABC" });
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[0][0]).toContain("status-update");
    expect(requestMock.mock.calls[1][0]).toContain("remote-start");
    expect(props.patchConnectorStatus).toHaveBeenCalledWith(1, "PREPARING");
  });
});
