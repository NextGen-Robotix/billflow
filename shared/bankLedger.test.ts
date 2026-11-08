import { describe, expect, it } from "vitest";
import { calculateBankLedger } from "./bankLedger";

describe("calculateBankLedger", () => {
  it("calculates period totals, opening/closing balance and running balances", () => {
    const result = calculateBankLedger(
      "1000.00",
      "2026-04-01",
      [
        {
          id: 1,
          transactionDate: "2026-04-01",
          direction: "credit",
          amount: "100.00",
        },
        {
          id: 2,
          transactionDate: "2026-04-02",
          direction: "debit",
          amount: "30.00",
        },
        {
          id: 3,
          transactionDate: "2026-04-30",
          direction: "credit",
          amount: "10.00",
        },
      ],
      "2026-04-02",
      "2026-04-30"
    );

    expect(result.periodOpeningBalance).toBe(1100);
    expect(result.credits).toBe(10);
    expect(result.debits).toBe(30);
    expect(result.periodClosingBalance).toBe(1080);
    expect(result.currentBalance).toBe(1080);
    expect(result.transactions.map(row => row.balanceAfter)).toEqual([
      1070, 1080,
    ]);
  });

  it("applies an opening balance when its date falls within a selected period", () => {
    const result = calculateBankLedger(
      "500.00",
      "2026-10-01",
      [
        {
          id: 1,
          transactionDate: "2026-10-02",
          direction: "credit",
          amount: "20.00",
        },
      ],
      "2026-09-01",
      "2026-10-02"
    );

    expect(result.periodOpeningBalance).toBe(0);
    expect(result.periodClosingBalance).toBe(520);
    expect(result.transactions[0].balanceAfter).toBe(520);
  });

  it("reorders backdated transactions and recomputes later balances", () => {
    const result = calculateBankLedger(
      "100.00",
      null,
      [
        {
          id: 3,
          transactionDate: "2026-10-04",
          direction: "debit",
          amount: "10.00",
        },
        {
          id: 1,
          transactionDate: "2026-10-03",
          direction: "credit",
          amount: "50.00",
        },
        {
          id: 2,
          transactionDate: "2026-10-02",
          direction: "credit",
          amount: "20.00",
        },
      ],
      "2026-10-01",
      "2026-10-31"
    );

    expect(result.transactions.map(row => row.transactionDate)).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(result.transactions.map(row => row.balanceAfter)).toEqual([
      120, 170, 160,
    ]);
    expect(result.currentBalance).toBe(160);
  });
});
