export type BankLedgerTransaction = {
  id: number;
  transactionDate: string;
  direction: "credit" | "debit";
  amount: number | string;
};

export type BankLedgerSummary<
  T extends BankLedgerTransaction = BankLedgerTransaction,
> = {
  openingBalance: number;
  periodOpeningBalance: number;
  periodClosingBalance: number;
  currentBalance: number;
  credits: number;
  debits: number;
  transactions: Array<T & { balanceAfter: number }>;
};

const toCents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const fromCents = (value: number) => Number((value / 100).toFixed(2));

function baselineAt(
  openingCents: number,
  openingDate: string | null,
  date: string
) {
  return openingDate && date < openingDate ? 0 : openingCents;
}

function signedCents(row: BankLedgerTransaction) {
  const amount = toCents(row.amount);
  return row.direction === "credit" ? amount : -amount;
}

export function calculateBankLedger<T extends BankLedgerTransaction>(
  openingBalance: number | string,
  openingDate: string | null,
  rows: T[],
  from: string,
  to: string
): BankLedgerSummary<T> {
  const openingCents = toCents(openingBalance);
  const chronological = rows
    .slice()
    .sort(
      (left, right) =>
        left.transactionDate.localeCompare(right.transactionDate) ||
        left.id - right.id
    );
  let runningCents = openingCents;
  const balancedRows = chronological.map(row => {
    runningCents += signedCents(row);
    return { ...row, balanceAfter: fromCents(runningCents) };
  });
  const periodRows = balancedRows.filter(
    row => row.transactionDate >= from && row.transactionDate <= to
  );
  const beforePeriod = balancedRows.filter(row => row.transactionDate < from);
  const throughPeriod = balancedRows.filter(row => row.transactionDate <= to);
  let periodOpeningCents = baselineAt(openingCents, openingDate, from);
  for (const row of beforePeriod) periodOpeningCents += signedCents(row);
  let periodClosingCents = baselineAt(openingCents, openingDate, to);
  for (const row of throughPeriod) periodClosingCents += signedCents(row);
  const creditsCents = periodRows.reduce(
    (sum, row) => sum + (row.direction === "credit" ? toCents(row.amount) : 0),
    0
  );
  const debitsCents = periodRows.reduce(
    (sum, row) => sum + (row.direction === "debit" ? toCents(row.amount) : 0),
    0
  );

  return {
    openingBalance: fromCents(openingCents),
    periodOpeningBalance: fromCents(periodOpeningCents),
    periodClosingBalance: fromCents(periodClosingCents),
    currentBalance: fromCents(periodClosingCents),
    credits: fromCents(creditsCents),
    debits: fromCents(debitsCents),
    transactions: periodRows,
  };
}
