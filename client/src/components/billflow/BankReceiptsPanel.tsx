import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Download,
  FileText,
  Plus,
  Printer,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  BANK_METHODS,
  BANK_PURPOSES,
  type BankMethod,
  type BankPurpose,
} from "@shared/bankOptions";
import { buildBankStatementPdf } from "@/lib/bankStatementPdf";
import { getBankPeriodRange, type BankPeriodPreset } from "@/lib/periodRange";
import { trpc } from "@/lib/trpc";

type ReceiptDraft = {
  transactionDate: string;
  direction: "credit" | "debit";
  amount: string;
  method: BankMethod;
  methodOther: string;
  purposeCategory: BankPurpose;
  purposeOther: string;
  counterparty: string;
  reference: string;
  notes: string;
};

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const blankDraft = (): ReceiptDraft => ({
  transactionDate: today(),
  direction: "credit",
  amount: "",
  method: "UPI",
  methodOther: "",
  purposeCategory: "Customer receipt",
  purposeOther: "",
  counterparty: "",
  reference: "",
  notes: "",
});

const PERIOD_OPTIONS: { value: BankPeriodPreset; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "60days", label: "Last 60 days" },
  { value: "90days", label: "Last 90 days" },
  { value: "fy", label: "This FY" },
];

function money(value: unknown, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
  } catch {
    return `INR ${Number(value ?? 0).toFixed(2)}`;
  }
}

function formatDate(value?: string | null) {
  return value
    ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
}

function dateLabel(preset: BankPeriodPreset) {
  return (
    PERIOD_OPTIONS.find(option => option.value === preset)?.label ??
    "This month"
  );
}

function transactionPurpose(row: any) {
  return row.purposeCategory === "Other"
    ? row.purposeOther || "Other"
    : row.purposeCategory;
}

function transactionMethod(row: any) {
  return row.method === "Other" ? row.methodOther || "Other" : row.method;
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="bank-modal-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`bank-modal ${wide ? "bank-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="bank-modal-header">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            className="icon-btn"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={17} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function BankReceiptsPanel({
  companyName,
  currency,
  canEdit,
  isAdmin,
}: {
  companyName: string;
  currency: string;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState<BankPeriodPreset>("month");
  const [todayKey, setTodayKey] = useState(today);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [showOpening, setShowOpening] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("0.00");
  const [openingDate, setOpeningDate] = useState(today());
  const [showPdf, setShowPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const range = getBankPeriodRange(period, todayKey);
  const periodCaption = `${dateLabel(period)} · ${formatDate(range.from)} – ${formatDate(range.to)}`;
  const statement = trpc.bankReceipts.list.useQuery(range);
  const transactions = statement.data?.transactions ?? [];
  const visibleTransactions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return transactions;
    return transactions.filter((row: any) =>
      [
        transactionPurpose(row),
        transactionMethod(row),
        row.counterparty,
        row.reference,
        row.notes,
        row.direction,
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(term))
    );
  }, [transactions, search]);

  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(today()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl]
  );

  const addTransaction = trpc.bankReceipts.add.useMutation({
    onSuccess: async () => {
      toast.success("Bank transaction recorded");
      setDraft(null);
      await utils.bankReceipts.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const setOpeningBalance = trpc.bankReceipts.setOpeningBalance.useMutation({
    onSuccess: async () => {
      toast.success("Opening balance saved");
      setShowOpening(false);
      await utils.bankReceipts.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    addTransaction.mutate({
      transactionDate: draft.transactionDate,
      direction: draft.direction,
      amount: Number(draft.amount),
      method: draft.method,
      methodOther: draft.method === "Other" ? draft.methodOther : undefined,
      purposeCategory: draft.purposeCategory,
      purposeOther:
        draft.purposeCategory === "Other" ? draft.purposeOther : undefined,
      counterparty: draft.counterparty || undefined,
      reference: draft.reference || undefined,
      notes: draft.notes || undefined,
    });
  }

  function openOpeningEditor() {
    setOpeningAmount(String(statement.data?.openingBalance ?? 0));
    setOpeningDate(statement.data?.openingDate || todayKey);
    setShowOpening(true);
  }

  async function createStatementPdf() {
    if (!statement.data) throw new Error("Bank statement is still loading.");
    const bytes = await buildBankStatementPdf({
      companyName,
      currency,
      periodLabel: periodCaption,
      from: range.from,
      to: range.to,
      openingBalance: statement.data.periodOpeningBalance,
      closingBalance: statement.data.periodClosingBalance,
      credits: statement.data.credits,
      debits: statement.data.debits,
      transactions: transactions.map((row: any) => ({
        transactionDate: row.transactionDate,
        direction: row.direction,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        method: row.method,
        methodOther: row.methodOther,
        purposeCategory: row.purposeCategory,
        purposeOther: row.purposeOther,
        counterparty: row.counterparty,
        reference: row.reference,
      })),
    });
    return bytes;
  }

  function asPdfBlob(bytes: Uint8Array) {
    return new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: "application/pdf",
    });
  }

  async function previewPdf() {
    setPdfBusy(true);
    try {
      const bytes = await createStatementPdf();
      const nextUrl = URL.createObjectURL(asPdfBlob(bytes));
      setPdfUrl(nextUrl);
      setShowPdf(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not build bank statement PDF."
      );
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const bytes = await createStatementPdf();
      const url = URL.createObjectURL(asPdfBlob(bytes));
      const link = document.createElement("a");
      link.href = url;
      link.download = `bank-statement-${range.from}-to-${range.to}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not download bank statement PDF."
      );
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <section className="section-panel bank-receipts-panel">
      <div className="bank-page-header">
        <div>
          <div className="eyebrow">CURRENT ACCOUNT · MANUAL LEDGER</div>
          <h2>Bank Receipts</h2>
          <p>
            Maintain credits and debits with a running balance. Entries are kept
            separately from invoice payment records.
          </p>
        </div>
        <div className="bank-header-actions">
          {isAdmin && (
            <button className="quiet-btn" onClick={openOpeningEditor}>
              <Settings2 size={15} /> Opening balance
            </button>
          )}
          <button
            className="quiet-btn"
            onClick={() => void previewPdf()}
            disabled={pdfBusy || statement.isLoading}
          >
            <FileText size={15} />{" "}
            {pdfBusy ? "Preparing PDF…" : "Preview / print"}
          </button>
          <button
            className="quiet-btn"
            onClick={() => void downloadPdf()}
            disabled={pdfBusy || statement.isLoading}
          >
            <Download size={15} /> Download PDF
          </button>
          {canEdit && (
            <button
              className="primary-btn"
              onClick={() => setDraft(blankDraft())}
            >
              <Plus size={15} /> Add record
            </button>
          )}
        </div>
      </div>

      <div className="bank-period-toolbar">
        <div
          className="bank-period-switch"
          role="group"
          aria-label="Bank statement period"
        >
          {PERIOD_OPTIONS.map(option => (
            <button
              key={option.value}
              className={period === option.value ? "selected" : ""}
              onClick={() => setPeriod(option.value)}
              aria-pressed={period === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="bank-period-caption">
          <CalendarDays size={14} /> {periodCaption}
        </span>
      </div>

      <div className="bank-metric-grid">
        <article className="bank-metric-card bank-balance-card">
          <span>Current balance</span>
          <strong
            className={
              Number(statement.data?.currentBalance ?? 0) < 0
                ? "bank-negative"
                : ""
            }
          >
            {money(statement.data?.currentBalance, currency)}
          </strong>
          <small>
            {statement.data?.openingDate
              ? `Opening balance from ${formatDate(statement.data.openingDate)}`
              : "Opening balance defaults to zero until set"}
          </small>
        </article>
        <article className="bank-metric-card bank-credit-card">
          <span>Credits · selected period</span>
          <strong>{money(statement.data?.credits, currency)}</strong>
          <small>Amounts received or deposited</small>
        </article>
        <article className="bank-metric-card bank-debit-card">
          <span>Debits · selected period</span>
          <strong>{money(statement.data?.debits, currency)}</strong>
          <small>Payments, withdrawals and deductions</small>
        </article>
        <article className="bank-metric-card">
          <span>Transactions · selected period</span>
          <strong>{statement.data?.transactions.length ?? 0}</strong>
          <small>Chronological statement entries</small>
        </article>
      </div>

      <div className="bank-ledger-toolbar">
        <div>
          <h3>Account transactions</h3>
          <p>
            Running balances include every earlier transaction, including
            records outside this selected view.
          </p>
        </div>
        <div className="bank-search search-box">
          <Search size={15} />
          <input
            aria-label="Search bank transactions"
            placeholder="Search purpose, method, reference"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="data-table-wrap bank-table-wrap">
        <table className="bank-ledger-table">
          <thead>
            <tr>
              <th>DATE</th>
              <th>TRANSACTION / PURPOSE</th>
              <th>METHOD</th>
              <th className="right">CREDIT</th>
              <th className="right">DEBIT</th>
              <th className="right">CURRENT BALANCE</th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions
              .slice()
              .reverse()
              .map((row: any) => (
                <tr key={row.id}>
                  <td className="bank-date-cell">
                    {formatDate(row.transactionDate)}
                  </td>
                  <td>
                    <div className="bank-transaction-cell">
                      <span className={`bank-direction-pill ${row.direction}`}>
                        {row.direction === "credit" ? (
                          <ArrowDownLeft size={12} />
                        ) : (
                          <ArrowUpRight size={12} />
                        )}
                        {row.direction}
                      </span>
                      <b>{transactionPurpose(row)}</b>
                      {row.counterparty && <small>{row.counterparty}</small>}
                      {row.reference && <small>Ref · {row.reference}</small>}
                    </div>
                  </td>
                  <td>
                    <span className="bank-method-label">
                      {transactionMethod(row)}
                    </span>
                    {row.notes && (
                      <small className="bank-row-note" title={row.notes}>
                        {row.notes}
                      </small>
                    )}
                  </td>
                  <td className="right bank-credit-amount">
                    {row.direction === "credit"
                      ? money(row.amount, currency)
                      : "—"}
                  </td>
                  <td className="right bank-debit-amount">
                    {row.direction === "debit"
                      ? money(row.amount, currency)
                      : "—"}
                  </td>
                  <td
                    className={`right bank-running-balance ${Number(row.balanceAfter) < 0 ? "bank-negative" : ""}`}
                  >
                    {money(row.balanceAfter, currency)}
                    <small>after transaction</small>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {statement.isLoading && (
          <div className="table-loading">Loading bank transactions…</div>
        )}
        {!statement.isLoading && !visibleTransactions.length && (
          <div className="bank-empty-state">
            <Banknote size={24} />
            <b>
              {transactions.length
                ? "No matching transactions"
                : "No transactions in this period"}
            </b>
            <span>
              {transactions.length
                ? "Try a different search term."
                : "Add a current-account credit or debit to begin the ledger."}
            </span>
            {canEdit && !transactions.length && (
              <button
                className="primary-btn"
                onClick={() => setDraft(blankDraft())}
              >
                <Plus size={14} /> Add record
              </button>
            )}
          </div>
        )}
      </div>

      {draft && (
        <ModalShell
          title="Add bank transaction"
          subtitle="Record a current-account credit or debit. Amount is entered as a positive value."
          onClose={() => setDraft(null)}
        >
          <form className="bank-entry-form" onSubmit={submitTransaction}>
            <div className="bank-entry-grid">
              <label>
                Transaction date <em>*</em>
                <input
                  type="date"
                  required
                  value={draft.transactionDate}
                  onChange={event =>
                    setDraft({ ...draft, transactionDate: event.target.value })
                  }
                />
              </label>
              <label>
                Credit or debit <em>*</em>
                <select
                  value={draft.direction}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      direction: event.target
                        .value as ReceiptDraft["direction"],
                    })
                  }
                >
                  <option value="credit">Credit · money received</option>
                  <option value="debit">Debit · money sent/deducted</option>
                </select>
              </label>
              <label>
                Amount ({currency}) <em>*</em>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={draft.amount}
                  onChange={event =>
                    setDraft({ ...draft, amount: event.target.value })
                  }
                  placeholder="0.00"
                />
              </label>
              <label>
                Payment method <em>*</em>
                <select
                  value={draft.method}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      method: event.target.value as BankMethod,
                      methodOther: "",
                    })
                  }
                >
                  {BANK_METHODS.map(method => (
                    <option key={method}>{method}</option>
                  ))}
                </select>
              </label>
              {draft.method === "Other" && (
                <label>
                  Exact method <em>*</em>
                  <input
                    required
                    maxLength={160}
                    value={draft.methodOther}
                    onChange={event =>
                      setDraft({ ...draft, methodOther: event.target.value })
                    }
                    placeholder="Describe the payment method"
                  />
                </label>
              )}
              <label>
                Purpose category <em>*</em>
                <select
                  value={draft.purposeCategory}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      purposeCategory: event.target.value as BankPurpose,
                      purposeOther: "",
                    })
                  }
                >
                  {BANK_PURPOSES.map(purpose => (
                    <option key={purpose}>{purpose}</option>
                  ))}
                </select>
              </label>
              {draft.purposeCategory === "Other" && (
                <label>
                  Exact purpose <em>*</em>
                  <input
                    required
                    maxLength={240}
                    value={draft.purposeOther}
                    onChange={event =>
                      setDraft({ ...draft, purposeOther: event.target.value })
                    }
                    placeholder="Describe the exact transaction purpose"
                  />
                </label>
              )}
              <label>
                Counterparty / payer / payee
                <input
                  maxLength={180}
                  value={draft.counterparty}
                  onChange={event =>
                    setDraft({ ...draft, counterparty: event.target.value })
                  }
                  placeholder="Name of the person or business"
                />
              </label>
              <label>
                Reference / transaction ID
                <input
                  maxLength={160}
                  value={draft.reference}
                  onChange={event =>
                    setDraft({ ...draft, reference: event.target.value })
                  }
                  placeholder="UTR, cheque number, bank reference"
                />
              </label>
              <label className="bank-notes-field">
                Notes
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={draft.notes}
                  onChange={event =>
                    setDraft({ ...draft, notes: event.target.value })
                  }
                  placeholder="Optional detail to help reconcile this transaction"
                />
              </label>
            </div>
            <p className="bank-form-note">
              This manual bank ledger is maintained separately from invoice
              payments. For corrections, add a clearly described
              correction/reversal entry so the original record remains
              auditable.
            </p>
            <div className="bank-modal-actions">
              <button
                type="button"
                className="quiet-btn"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={addTransaction.isPending}
              >
                <Plus size={14} />{" "}
                {addTransaction.isPending ? "Saving…" : "Add transaction"}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {showOpening && (
        <ModalShell
          title="Set opening balance"
          subtitle="Admin-only. This balance is the account baseline before transactions on the opening date."
          onClose={() => setShowOpening(false)}
        >
          <form
            className="bank-entry-form"
            onSubmit={event => {
              event.preventDefault();
              setOpeningBalance.mutate({
                amount: Number(openingAmount),
                date: openingDate,
              });
            }}
          >
            <div className="bank-entry-grid">
              <label>
                Opening balance ({currency}) <em>*</em>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={openingAmount}
                  onChange={event => setOpeningAmount(event.target.value)}
                />
                <small>
                  Use a negative amount if the account begins overdrawn.
                </small>
              </label>
              <label>
                Opening balance date <em>*</em>
                <input
                  type="date"
                  required
                  value={openingDate}
                  onChange={event => setOpeningDate(event.target.value)}
                />
                <small>
                  The opening date must be on or before the earliest recorded
                  transaction.
                </small>
              </label>
            </div>
            <div className="bank-modal-actions">
              <button
                type="button"
                className="quiet-btn"
                onClick={() => setShowOpening(false)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={setOpeningBalance.isPending}
              >
                {setOpeningBalance.isPending
                  ? "Saving…"
                  : "Save opening balance"}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {showPdf && (
        <ModalShell
          title="Bank statement preview"
          subtitle={`${companyName} · ${periodCaption}`}
          onClose={() => setShowPdf(false)}
          wide
        >
          <div className="bank-pdf-actions">
            <button
              className="quiet-btn"
              onClick={() => frameRef.current?.contentWindow?.print()}
              disabled={!pdfUrl}
            >
              <Printer size={14} /> Print
            </button>
            <button
              className="quiet-btn"
              onClick={() => void downloadPdf()}
              disabled={pdfBusy}
            >
              <Download size={14} /> Download PDF
            </button>
          </div>
          {pdfUrl ? (
            <iframe
              ref={frameRef}
              className="bank-pdf-frame"
              src={pdfUrl}
              title="Filtered Bank Receipts statement PDF"
            />
          ) : (
            <div className="bank-pdf-loading">
              Preparing portrait A4 statement…
            </div>
          )}
        </ModalShell>
      )}
    </section>
  );
}
