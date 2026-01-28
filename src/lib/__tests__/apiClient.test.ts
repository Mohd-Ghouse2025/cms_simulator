import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { TenantApiClient, normalizePaginatedResponse } from "../api";
import { endpoints } from "../endpoints";

const baseUrl = "http://tenant.test";
const tokens = { access: "test-token" };
const noopRefresh = async () => null;
const logout = vi.fn();

let lastConnectorRequest: URL | null = null;
let lastStartBody: unknown = null;
let lastStopBody: unknown = null;
let connectCalled = false;

const server = setupServer(
  http.get(`${baseUrl}${endpoints.cms.connectors}`, ({ request }) => {
    lastConnectorRequest = new URL(request.url);
    return HttpResponse.json([{ id: 1, connector_id: 1, status: "Available" }]);
  }),
  http.post(`${baseUrl}${endpoints.simulators.connect(1)}`, () => {
    connectCalled = true;
    return HttpResponse.json({ state: "CONNECTING" });
  }),
  http.post(`${baseUrl}${endpoints.simulators.remoteStart(1)}`, async ({ request }) => {
    lastStartBody = await request.json();
    return HttpResponse.json({ queued: true });
  }),
  http.post(`${baseUrl}${endpoints.simulators.remoteStop(1)}`, async ({ request }) => {
    lastStopBody = await request.json();
    return HttpResponse.json({ queued: true });
  })
);

describe("TenantApiClient", () => {
  const client = new TenantApiClient(baseUrl, tokens, noopRefresh, logout);

  beforeAll(() => server.listen());
  afterEach(() => {
    server.resetHandlers();
    lastConnectorRequest = null;
    lastStartBody = null;
    lastStopBody = null;
    connectCalled = false;
  });
  afterAll(() => server.close());

  it("normalizes paginated results and feature collections", async () => {
    const featureCollection = {
      type: "FeatureCollection",
      features: [{ id: 99, properties: { charger_id: "C-99" } }]
    };
    const normalized = normalizePaginatedResponse(featureCollection);
    expect(normalized.results[0]).toEqual(featureCollection.features[0]);
    expect(normalized.count).toBe(1);

    const connectorResponse = await client.requestPaginated<{ id: number; connector_id: number }>(
      endpoints.cms.connectors,
      { query: { charger_id: "CP-1", page_size: 5 } }
    );
    expect(connectorResponse.count).toBe(1);
    expect(connectorResponse.results[0].connector_id).toBe(1);
    expect(lastConnectorRequest?.searchParams.get("charger_id")).toBe("CP-1");
    expect(lastConnectorRequest?.searchParams.get("page_size")).toBe("5");
  });

  it("sends simulator lifecycle and transaction commands with expected payloads", async () => {
    await client.request(endpoints.simulators.connect(1), { method: "POST" });
    await client.request(endpoints.simulators.remoteStart(1), {
      method: "POST",
      body: { connectorId: 2, idTag: "SIM" }
    });
    await client.request(endpoints.simulators.remoteStop(1), {
      method: "POST",
      body: { transactionId: "T-123" }
    });

    expect(connectCalled).toBe(true);
    expect(lastStartBody).toEqual({ connectorId: 2, idTag: "SIM" });
    expect(lastStopBody).toEqual({ transactionId: "T-123" });
  });
});
