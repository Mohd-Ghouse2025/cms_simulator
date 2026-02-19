import { describe, expect, it } from "vitest";
import { formatCurrency } from "../currency";

describe("formatCurrency", () => {
  it("defaults to INR with rupee symbol", () => {
    const formatted = formatCurrency(123.45);
    expect(formatted).toMatch(/₹\s?123\.45/);
  });
});
