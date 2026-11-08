export const BANK_METHODS = [
  "UPI",
  "NEFT",
  "RTGS",
  "IMPS",
  "Cheque",
  "Cash deposit",
  "Cash withdrawal",
  "Bank transfer",
  "Card/POS",
  "NACH/ECS",
  "Net banking",
  "Other",
] as const;

export const BANK_PURPOSES = [
  "Customer receipt",
  "Vendor payment",
  "Commissions",
  "Consulting fees",
  "Rent",
  "Software",
  "Marketing",
  "Operating expenses",
  "Reimbursements",
  "Salary",
  "Taxes/statutory dues",
  "Loan/EMI",
  "Bank charges",
  "Interest",
  "Cash deposit",
  "Cash withdrawal",
  "Internal transfer",
  "Refund",
  "Correction/reversal",
  "Other",
] as const;

export type BankMethod = (typeof BANK_METHODS)[number];
export type BankPurpose = (typeof BANK_PURPOSES)[number];
