import { describe, expect, it } from "vitest";
import { getBankPeriodRange, getPeriodRange } from "./periodRange";

describe("getPeriodRange", () => {
  it("returns month-to-date", () => {
    expect(getPeriodRange("month", "2026-10-23", "", "")).toEqual({
      from: "2026-10-01",
      to: "2026-10-23",
    });
  });

  it("uses the current Indian financial quarter", () => {
    expect(getPeriodRange("quarter", "2026-10-23", "", "")).toEqual({
      from: "2026-10-01",
      to: "2026-10-23",
    });
    expect(getPeriodRange("quarter", "2026-02-15", "", "")).toEqual({
      from: "2026-01-01",
      to: "2026-02-15",
    });
  });

  it("uses the Indian financial year starting 1 April", () => {
    expect(getPeriodRange("fy", "2026-02-15", "", "")).toEqual({
      from: "2025-04-01",
      to: "2026-02-15",
    });
  });

  it("uses and normalizes custom inclusive dates", () => {
    expect(
      getPeriodRange("custom", "2026-10-23", "2026-08-15", "2026-09-20")
    ).toEqual({ from: "2026-08-15", to: "2026-09-20" });
    expect(
      getPeriodRange("custom", "2026-10-23", "2026-09-20", "2026-08-15")
    ).toEqual({ from: "2026-08-15", to: "2026-09-20" });
  });
});

describe("getBankPeriodRange", () => {
  it("returns the current month through today", () => {
    expect(getBankPeriodRange("month", "2026-10-25")).toEqual({
      from: "2026-10-01",
      to: "2026-10-25",
    });
  });

  it("returns inclusive 60- and 90-calendar-day windows", () => {
    expect(getBankPeriodRange("60days", "2026-10-25")).toEqual({
      from: "2026-08-27",
      to: "2026-10-25",
    });
    expect(getBankPeriodRange("90days", "2026-10-25")).toEqual({
      from: "2026-07-28",
      to: "2026-10-25",
    });
  });

  it("uses the Indian financial year beginning 1 April", () => {
    expect(getBankPeriodRange("fy", "2026-02-15")).toEqual({
      from: "2025-04-01",
      to: "2026-02-15",
    });
    expect(getBankPeriodRange("fy", "2026-04-01")).toEqual({
      from: "2026-04-01",
      to: "2026-04-01",
    });
  });
});
