import { describe, expect, it } from "vitest";
import { resolveExpenseReimbursementStatus } from "./expenseStatus";

describe("resolveExpenseReimbursementStatus", () => {
  const today = "2026-10-23";

  it("keeps a reimbursed expense paid even after its old due date", () => {
    expect(resolveExpenseReimbursementStatus("paid", "2026-10-10", today)).toBe(
      "paid"
    );
  });

  it("shows a future reimbursement as due", () => {
    expect(resolveExpenseReimbursementStatus("due", "2026-10-30", today)).toBe(
      "due"
    );
  });

  it("keeps a reimbursement due on the current date as due", () => {
    expect(resolveExpenseReimbursementStatus("due", today, today)).toBe("due");
  });

  it("automatically shows an unpaid reimbursement as overdue after its due date", () => {
    expect(resolveExpenseReimbursementStatus("due", "2026-10-22", today)).toBe(
      "overdue"
    );
  });
});
