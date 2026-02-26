import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocketChannel } from "../useWebSocketChannel";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  addEventListener(_type: string, _handler: (...args: any[]) => void) {
    // noop for tests
  }
  removeEventListener(_type: string, _handler: (...args: any[]) => void) {
    // noop for tests
  }

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
    mockInstances.push(this);
  }

  close(code?: number, reason?: string) {
    mockCloseCalls.push({ code, reason });
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send() {
    // noop for tests
  }
}

const originalWebSocket = global.WebSocket;
let mockInstances: MockWebSocket[];
let mockCloseCalls: Array<{ code?: number; reason?: string }>;

describe("useWebSocketChannel", () => {
  beforeEach(() => {
    mockInstances = [];
    mockCloseCalls = [];
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  it("does not recreate or close an existing socket when connect is called with the same URL while open", () => {
    const url = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=abc";
    const { result, unmount } = renderHook(() =>
      useWebSocketChannel({
        url,
        shouldConnect: true
      })
    );

    act(() => {
      result.current.connect();
    });

    expect(mockInstances.length).toBe(1);

    const ws = mockInstances[0];
    act(() => {
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();
    });

    act(() => {
      result.current.connect();
    });

    expect(mockInstances.length).toBe(1);
    expect(mockCloseCalls.length).toBe(0);

    unmount();
  });

  it("keeps the socket open when only the token changes", () => {
    const url1 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=abc";
    const url2 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=def";
    const { result, rerender } = renderHook(
      ({ url }) =>
        useWebSocketChannel({
          url,
          shouldConnect: true
        }),
      { initialProps: { url: url1 } }
    );

    act(() => {
      result.current.connect();
    });
    expect(mockInstances.length).toBe(1);

    const ws = mockInstances[0];
    act(() => {
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();
    });

    rerender({ url: url2 });

    expect(mockInstances.length).toBe(1);
    expect(mockCloseCalls.length).toBe(0);
  });

  it("ignores _ts churn and does not recreate the socket", () => {
    const url1 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=abc&_ts=1";
    const url2 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=abc&_ts=2";
    const { result, rerender } = renderHook(
      ({ url }) =>
        useWebSocketChannel({
          url,
          shouldConnect: true
        }),
      { initialProps: { url: url1 } }
    );

    act(() => {
      result.current.connect();
    });
    const ws = mockInstances[0];
    act(() => {
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();
    });

    rerender({ url: url2 });

    expect(mockInstances.length).toBe(1);
    expect(mockCloseCalls.length).toBe(0);
  });

  it("reconnects with the latest token after a server close", () => {
    const url1 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=abc";
    const url2 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=def";
    const { result, rerender } = renderHook(
      ({ url }) =>
        useWebSocketChannel({
          url,
          shouldConnect: true,
          autoReconnect: false, // rely on shouldConnect-driven reconnect
        }),
      { initialProps: { url: url1 } }
    );

    act(() => {
      result.current.connect();
    });
    const ws = mockInstances[0];
    act(() => {
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();
    });

    rerender({ url: url2 });

    act(() => {
      ws.onclose?.({ code: 4001, reason: "server-close" } as any);
      vi.runAllTimers();
    });

    expect(mockInstances.length).toBe(2);
    expect(mockInstances[1].url).toContain("token=def");
  });

  it("does not dispose the socket when url becomes temporarily null (token refresh)", () => {
    const url1 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=abc";
    const { result, rerender } = renderHook(
      ({ url }) =>
        useWebSocketChannel({
          url,
          shouldConnect: true
        }),
      { initialProps: { url: url1 } }
    );

    act(() => {
      result.current.connect();
    });
    const ws = mockInstances[0];
    act(() => {
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();
    });

    rerender({ url: null });

    expect(mockInstances.length).toBe(1);
    expect(mockCloseCalls.length).toBe(0);
  });

  it("reconnects with latest token after server close even if url was null briefly", () => {
    const url1 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=abc";
    const url2 = "wss://example.com/ws/ocpp-sim/CHG-1/?tenant_schema=cms&token=def";
    const { result, rerender } = renderHook(
      ({ url }) =>
        useWebSocketChannel({
          url,
          shouldConnect: true,
          autoReconnect: false
        }),
      { initialProps: { url: url1 } }
    );

    act(() => {
      result.current.connect();
    });
    const ws = mockInstances[0];
    act(() => {
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();
    });

    rerender({ url: null });
    rerender({ url: url2 });

    act(() => {
      ws.onclose?.({ code: 4001, reason: "server-close" } as any);
      vi.runAllTimers();
    });

    expect(mockInstances.length).toBe(2);
    expect(mockInstances[1].url).toContain("token=def");
  });
});
