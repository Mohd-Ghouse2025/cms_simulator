import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useWebSocketChannel } from "../useWebSocketChannel";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  protocols?: string | string[];
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

describe("useWebSocketChannel", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      MockWebSocket as unknown as typeof WebSocket;
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
    MockWebSocket.instances = [];
  });

  it("connects, emits messages, and exposes sent payloads", async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useWebSocketChannel({
        url: "ws://example.test/socket",
        onMessage,
        autoReconnect: false
      })
    );

    await waitFor(() => expect(result.current.status).toBe("open"));

    act(() => {
      MockWebSocket.instances[0]?.emitMessage({ type: "ping", ok: true });
    });

    expect(onMessage).toHaveBeenCalled();
    expect(result.current.lastMessage).toEqual({ type: "ping", ok: true });

    act(() => {
      result.current.send({ hello: "world" });
    });

    expect(MockWebSocket.instances[0]?.sent[0]).toBe(JSON.stringify({ hello: "world" }));

    act(() => {
      MockWebSocket.instances[0]?.close(1000, "done");
    });
    await waitFor(() => expect(result.current.status).toBe("closed"));
  });
});
