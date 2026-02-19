import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RemoteStartModal } from "../components/RemoteStartModal";

vi.mock("@/hooks/useTenantApi", () => ({
  useTenantApi: () => ({
    requestPaginated: vi.fn().mockResolvedValue({ results: [] }),
    request: vi.fn()
  })
}));

vi.mock("@/features/auth/useTenantAuth", () => ({
  useTenantAuth: () => ({ tokens: null })
}));

describe("RemoteStartModal", () => {
  const wrapper = (ui: React.ReactNode) => {
    const client = new QueryClient();
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  };

  const baseProps = {
    open: true,
    connectors: [{ connector_id: 1, format: "CCS", max_kw: 50, initial_status: "PREPARING" }] as any,
    busy: false,
    initialConnectorId: 1,
    summaryByConnector: {},
    defaultPricePerKwh: null,
    onCancel: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined)
  };

  it("shows only the relevant limit input for the selected limit type", () => {
    wrapper(<RemoteStartModal {...baseProps} />);

    // default no limit -> no limit input
    expect(screen.queryByPlaceholderText(/e.g. 5.0/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/e.g. 200.00/i)).toBeNull();

    fireEvent.click(screen.getByLabelText(/Energy limit/i));
    expect(screen.getByPlaceholderText(/e.g. 5.0/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/e.g. 200.00/i)).toBeNull();

    fireEvent.click(screen.getByLabelText(/Cost limit/i));
    expect(screen.getByPlaceholderText(/e.g. 200.00/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/e.g. 5.0/i)).toBeNull();

    fireEvent.click(screen.getByLabelText(/No limit/i));
    expect(screen.queryByPlaceholderText(/e.g. 200.00/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/e.g. 5.0/i)).toBeNull();
  });

  it("does not render live progress in the start modal", () => {
    wrapper(<RemoteStartModal {...baseProps} />);
    expect(screen.queryByText(/Live progress/i)).toBeNull();
  });
});
