export type ExpenseReimbursementStatus = "paid" | "due" | "overdue";

export function resolveExpenseReimbursementStatus(
  status: "paid" | "due",
  dueDate: string | null | undefined,
  today: string
): ExpenseReimbursementStatus {
  if (status === "paid") return "paid";
  if (dueDate && dueDate < today) return "overdue";
  return "due";
}
