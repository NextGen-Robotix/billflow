import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeIndianRupee,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRoundPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WorkspaceModal } from "./WorkspaceModal";
import { useEffect } from "react";
import { resolveExpenseReimbursementStatus } from "@/lib/expenseStatus";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const money = (amount: unknown, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0));
const categories = [
  "Rent",
  "Salary",
  "Software",
  "Travel",
  "Misc",
  "Other",
] as const;

type ExpenseDraft = {
  id?: number;
  date: string;
  amount: string;
  purpose: string;
  kind: "invoice" | "other";
  invoiceId: string;
  paidBy: string;
  category: string;
  reimbursementStatus: "paid" | "due";
  reimbursementDueDate: string;
  reimbursedDate: string;
};
type ReimbursementFilter = "all" | "outstanding" | "paid" | "due" | "overdue";
const emptyDraft = (): ExpenseDraft => ({
  date: today(),
  amount: "",
  purpose: "",
  kind: "invoice",
  invoiceId: "",
  paidBy: "",
  category: "Other",
  reimbursementStatus: "due",
  reimbursementDueDate: "",
  reimbursedDate: "",
});

export function ExpensesPanel({
  currency,
  invoices,
  canEdit,
  dateFrom,
  dateTo,
  periodLabel,
}: {
  currency: string;
  invoices: any[];
  canEdit: boolean;
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | "invoice" | "other">("all");
  const [payerFilter, setPayerFilter] = useState("");
  const [reimbursementFilter, setReimbursementFilter] =
    useState<ReimbursementFilter>("all");
  const [todayKey, setTodayKey] = useState(today);
  const [draft, setDraft] = useState<ExpenseDraft | null>(null);
  const [explorePayer, setExplorePayer] = useState<string | null>(null);
  const [showHeadModal, setShowHeadModal] = useState(false);
  const [headName, setHeadName] = useState("");
  const [editingHeadId, setEditingHeadId] = useState<number | null>(null);
  const [editingHeadName, setEditingHeadName] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(today()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const headData = trpc.expenses.heads.useQuery();
  const expenseData = trpc.expenses.list.useQuery({
    search: search || undefined,
    kind: type,
    paidBy: payerFilter || undefined,
    dateFrom,
    dateTo,
  });
  const detailData = trpc.expenses.list.useQuery(
    { paidBy: explorePayer ?? undefined, dateFrom, dateTo },
    { enabled: !!explorePayer }
  );
  const save = trpc.expenses.save.useMutation({
    onSuccess: async () => {
      toast.success(draft?.id ? "Expense updated" : "Expense recorded");
      setDraft(null);
      await Promise.all([
        utils.expenses.list.invalidate(),
        utils.dashboard.overview.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.expenses.remove.useMutation({
    onSuccess: async () => {
      toast.success("Expense removed");
      await Promise.all([
        utils.expenses.list.invalidate(),
        utils.dashboard.overview.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const addHead = trpc.expenses.addHead.useMutation({
    onSuccess: async result => {
      toast.success(`Expense head “${result.name}” added`);
      setHeadName("");
      setShowHeadModal(false);
      await utils.expenses.heads.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const updateHead = trpc.expenses.updateHead.useMutation({
    onSuccess: async result => {
      toast.success(`Expense head “${result.name}” updated`);
      setEditingHeadId(null);
      setEditingHeadName("");
      await Promise.all([
        utils.expenses.heads.invalidate(),
        utils.expenses.list.invalidate(),
        utils.dashboard.overview.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const removeHead = trpc.expenses.removeHead.useMutation({
    onSuccess: async () => {
      toast.success("Expense head deleted");
      await Promise.all([
        utils.expenses.heads.invalidate(),
        utils.expenses.list.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const entries = expenseData.data?.entries ?? [];
  const payerNames = expenseData.data?.payerNames ?? [];
  const filteredEntries = useMemo(
    () =>
      entries.filter(({ expense }: any) => {
        const status = resolveExpenseReimbursementStatus(
          expense.reimbursementStatus ?? "paid",
          expense.reimbursementDueDate,
          todayKey
        );
        return (
          reimbursementFilter === "all" ||
          (reimbursementFilter === "outstanding" && status !== "paid") ||
          reimbursementFilter === status
        );
      }),
    [entries, reimbursementFilter, todayKey]
  );
  const reimbursementTotals = useMemo(
    () =>
      entries.reduce(
        (totals: any, row: any) => {
          const expense = row.expense;
          const status = resolveExpenseReimbursementStatus(
            expense.reimbursementStatus ?? "paid",
            expense.reimbursementDueDate,
            todayKey
          );
          if (status !== "paid") {
            totals.pending += Number(expense.amount);
            totals.pendingCount += 1;
          }
          if (status === "overdue") {
            totals.overdue += Number(expense.amount);
            totals.overdueCount += 1;
          }
          return totals;
        },
        { pending: 0, pendingCount: 0, overdue: 0, overdueCount: 0 }
      ),
    [entries, todayKey]
  );
  const availableCategories = useMemo(
    () => [
      ...new Set([
        ...categories,
        ...(headData.data ?? []).map(head => head.name),
        ...(draft?.kind === "other" && draft.category ? [draft.category] : []),
      ]),
    ],
    [headData.data, draft?.category, draft?.kind]
  );
  const rollup = useMemo(() => {
    const result = new Map<
      string,
      {
        invoice: number;
        other: number;
        due: number;
        overdue: number;
        rows: any[];
      }
    >();
    for (const row of filteredEntries) {
      const expense = row.expense;
      const current = result.get(expense.paidBy) ?? {
        invoice: 0,
        other: 0,
        due: 0,
        overdue: 0,
        rows: [],
      };
      const expenseAmount = Number(expense.amount);
      current[expense.kind] += expenseAmount;
      const status = resolveExpenseReimbursementStatus(
        expense.reimbursementStatus ?? "paid",
        expense.reimbursementDueDate,
        todayKey
      );
      if (status === "due") current.due += expenseAmount;
      if (status === "overdue") current.overdue += expenseAmount;
      current.rows.push(row);
      result.set(expense.paidBy, current);
    }
    return result;
  }, [filteredEntries, todayKey]);
  const totals = useMemo(
    () =>
      filteredEntries.reduce(
        (sum, row) => {
          sum.total += Number(row.expense.amount);
          sum[row.expense.kind] += Number(row.expense.amount);
          return sum;
        },
        { total: 0, invoice: 0, other: 0 }
      ),
    [filteredEntries]
  );
  const payerCount = new Set(filteredEntries.map(row => row.expense.paidBy))
    .size;

  function openEdit(row?: any) {
    if (!canEdit) return;
    if (!row) {
      setDraft(emptyDraft());
      return;
    }
    const expense = row.expense;
    const category = expense.category || "Other";
    setDraft({
      id: expense.id,
      date: expense.date,
      amount: String(expense.amount),
      purpose: expense.purpose,
      kind: expense.kind,
      invoiceId: expense.invoiceId ? String(expense.invoiceId) : "",
      paidBy: expense.paidBy,
      category,
      reimbursementStatus: expense.reimbursementStatus ?? "paid",
      reimbursementDueDate: expense.reimbursementDueDate ?? "",
      reimbursedDate: expense.reimbursedDate ?? "",
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const category = draft.category;
    save.mutate({
      id: draft.id,
      date: draft.date,
      amount: Number(draft.amount),
      purpose: draft.purpose,
      kind: draft.kind,
      invoiceId: draft.kind === "invoice" ? Number(draft.invoiceId) : undefined,
      paidBy: draft.paidBy,
      category: draft.kind === "other" ? category : undefined,
      reimbursementStatus: draft.reimbursementStatus,
      reimbursementDueDate: draft.reimbursementDueDate || null,
      reimbursedDate: draft.reimbursedDate || null,
    });
  }

  return (
    <section className="expenses-workspace">
      <div className="section-toolbar">
        <div>
          <div className="eyebrow">SPEND</div>
          <h2>Expenses</h2>
          <p>
            Costs against invoices and everything else the business pays for.
          </p>
        </div>
        {canEdit && (
          <div className="toolbar-actions expense-actions">
            <button
              type="button"
              className="quiet-btn"
              onClick={() => setShowHeadModal(true)}
            >
              <UserRoundPlus size={15} /> Add expense head
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => openEdit()}
            >
              <Plus size={16} /> Add expense
            </button>
          </div>
        )}
      </div>
      <div className="metric-grid expense-metrics">
        <ExpenseMetric
          label="Total spend"
          value={money(totals.total, currency)}
          detail={`${entries.length} entries`}
          icon={Wallet}
          tone="green"
        />
        <ExpenseMetric
          label="Invoice expenses"
          value={money(totals.invoice, currency)}
          detail="Direct cost linked to invoices"
          icon={FileText}
          tone="cyan"
        />
        <ExpenseMetric
          label="Other expenses"
          value={money(totals.other, currency)}
          detail="Operating and overhead spend"
          icon={BadgeIndianRupee}
          tone="yellow"
        />
        <ExpenseMetric
          label="Paid by"
          value={String(payerCount)}
          detail="people / accounts"
          icon={Users}
          tone="default"
        />
      </div>

      <section
        className="expense-reimbursement-overview"
        aria-label="Reimbursement tracking"
      >
        <div className="reimbursement-overview-heading">
          <div>
            <div className="eyebrow">REIMBURSEMENT TRACKING</div>
            <p>See what is still owed and what has passed its due date.</p>
          </div>
          <span>Due status updates automatically from the due date</span>
        </div>
        <div className="reimbursement-overview-cards">
          <button
            type="button"
            className="reimbursement-overview-card is-due"
            onClick={() => setReimbursementFilter("outstanding")}
          >
            <span>Pending reimbursement</span>
            <strong>{money(reimbursementTotals.pending, currency)}</strong>
            <small>{reimbursementTotals.pendingCount} due or overdue</small>
          </button>
          <button
            type="button"
            className="reimbursement-overview-card is-overdue"
            onClick={() => setReimbursementFilter("overdue")}
          >
            <span>Overdue</span>
            <strong>{money(reimbursementTotals.overdue, currency)}</strong>
            <small>{reimbursementTotals.overdueCount} past due date</small>
          </button>
        </div>
      </section>

      {rollup.size > 0 && (
        <section className="section-panel expense-matrix-panel">
          <div className="expense-subheading">
            <div>
              <div className="eyebrow">PAYER BREAKDOWN</div>
              <h3>Expenses by</h3>
              <p>Compare invoice costs and other spend for each person.</p>
            </div>
            <span className="expense-period-chip">{periodLabel}</span>
          </div>
          <div className="data-table-wrap expense-matrix-wrap">
            <table className="expense-matrix">
              <thead>
                <tr>
                  <th>EXPENSE TYPE</th>
                  {Array.from(rollup.keys()).map(payer => (
                    <th className="right" key={payer}>
                      <span className="payer-column-title">{payer}</span>
                      <button
                        className="matrix-explore"
                        onClick={() => setExplorePayer(payer)}
                      >
                        Explore <ArrowRight size={12} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="expense-kind-key kind-invoice" />
                    Invoice expenses
                  </td>
                  {Array.from(rollup).map(([payer, values]) => (
                    <td className="right" key={payer}>
                      {money(values.invoice, currency)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <span className="expense-kind-key kind-other" />
                    Other expenses
                  </td>
                  {Array.from(rollup).map(([payer, values]) => (
                    <td className="right" key={payer}>
                      {money(values.other, currency)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <span className="expense-kind-key kind-due" />
                    Reimbursement due
                  </td>
                  {Array.from(rollup).map(([payer, values]) => (
                    <td className="right" key={payer}>
                      {money(values.due + values.overdue, currency)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <span className="expense-kind-key kind-overdue" />
                    Overdue reimbursement
                  </td>
                  {Array.from(rollup).map(([payer, values]) => (
                    <td className="right" key={payer}>
                      {money(values.overdue, currency)}
                    </td>
                  ))}
                </tr>
                <tr className="expense-matrix-total">
                  <td>Total paid by each person</td>
                  {Array.from(rollup).map(([payer, values]) => (
                    <td className="right" key={payer}>
                      {money(values.invoice + values.other, currency)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section-panel expenses-table-panel">
        <div className="expense-filters">
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder="Search purpose, invoice, category…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <select
            value={type}
            onChange={event => setType(event.target.value as typeof type)}
          >
            <option value="all">All types</option>
            <option value="invoice">Invoice expenses</option>
            <option value="other">Other expenses</option>
          </select>
          <select
            value={payerFilter}
            onChange={event => setPayerFilter(event.target.value)}
          >
            <option value="">Everyone</option>
            {payerNames.map(payer => (
              <option value={payer} key={payer}>
                {payer}
              </option>
            ))}
          </select>
          <select
            value={reimbursementFilter}
            onChange={event =>
              setReimbursementFilter(event.target.value as ReimbursementFilter)
            }
            aria-label="Filter by reimbursement status"
          >
            <option value="all">All reimbursement statuses</option>
            <option value="outstanding">Due + overdue</option>
            <option value="paid">Paid / reimbursed</option>
            <option value="due">Due</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
        <div className="data-table-wrap">
          <table className="expenses-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>PURPOSE</th>
                <th>TYPE</th>
                <th>INVOICE / CATEGORY</th>
                <th>PAID BY</th>
                <th>REIMBURSEMENT</th>
                <th className="right">AMOUNT</th>
                {canEdit && <th className="right">ACTIONS</th>}
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((row: any) => {
                const expense = row.expense;
                const reimbursementStatus = resolveExpenseReimbursementStatus(
                  expense.reimbursementStatus ?? "paid",
                  expense.reimbursementDueDate,
                  todayKey
                );
                return (
                  <tr key={expense.id}>
                    <td>
                      {new Date(`${expense.date}T00:00:00`).toLocaleDateString(
                        "en-IN",
                        { day: "2-digit", month: "short", year: "numeric" }
                      )}
                    </td>
                    <td className="expense-purpose-cell">{expense.purpose}</td>
                    <td>
                      <span
                        className={`expense-type-badge ${expense.kind === "invoice" ? "is-invoice" : "is-other"}`}
                      >
                        {expense.kind === "invoice"
                          ? "Invoice expense"
                          : "Other expense"}
                      </span>
                    </td>
                    <td>
                      {row.invoice?.number ? (
                        <span className="mono">
                          {row.invoice.number} · {row.customer?.name}
                        </span>
                      ) : (
                        expense.category || "—"
                      )}
                    </td>
                    <td>{expense.paidBy}</td>
                    <td>
                      <ReimbursementCell
                        status={reimbursementStatus}
                        dueDate={expense.reimbursementDueDate}
                        reimbursedDate={expense.reimbursedDate}
                      />
                    </td>
                    <td className="right amount-col">
                      {money(expense.amount, currency)}
                    </td>
                    {canEdit && (
                      <td className="right">
                        <div className="row-actions">
                          <button
                            className="small-action"
                            title="Edit expense"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="small-action danger-icon"
                            title="Delete expense"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete expense “${expense.purpose}”?`
                                )
                              )
                                remove.mutate({ id: expense.id });
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {expenseData.isLoading && (
            <div className="table-loading">
              <LoaderCircle className="spin" size={18} /> Loading expenses…
            </div>
          )}
          {!expenseData.isLoading && filteredEntries.length === 0 && (
            <div className="expense-table-empty">
              <Wallet size={20} />
              <span>
                {search ||
                type !== "all" ||
                payerFilter ||
                reimbursementFilter !== "all"
                  ? "No expenses match this view."
                  : "No expenses yet. Add your first one."}
              </span>
              {canEdit &&
                (search ||
                  type !== "all" ||
                  payerFilter ||
                  reimbursementFilter !== "all") && (
                  <button
                    className="text-btn"
                    onClick={() => {
                      setSearch("");
                      setType("all");
                      setPayerFilter("");
                      setReimbursementFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                )}
            </div>
          )}
        </div>
      </section>

      {showHeadModal && (
        <WorkspaceModal
          title="Expense heads"
          subtitle="Manage company categories available for other expenses."
          onClose={() => {
            setShowHeadModal(false);
            setHeadName("");
            setEditingHeadId(null);
            setEditingHeadName("");
          }}
        >
          <div className="expense-head-manager">
            <div className="expense-head-group-label">Built-in heads</div>
            <div className="expense-head-builtins">
              {categories.map(category => (
                <span key={category}>{category}</span>
              ))}
            </div>
            <div className="expense-head-group-label">Custom heads</div>
            <div className="expense-head-list">
              {headData.isLoading ? (
                <div className="muted">Loading expense heads…</div>
              ) : (headData.data ?? []).length === 0 ? (
                <div className="expense-head-empty">
                  No custom heads yet. Add one below.
                </div>
              ) : (
                headData.data?.map(head => (
                  <div className="expense-head-row" key={head.id}>
                    {editingHeadId === head.id ? (
                      <form
                        className="expense-head-edit"
                        onSubmit={event => {
                          event.preventDefault();
                          updateHead.mutate({
                            id: head.id,
                            name: editingHeadName.trim(),
                          });
                        }}
                      >
                        <input
                          required
                          maxLength={80}
                          value={editingHeadName}
                          onChange={event =>
                            setEditingHeadName(event.target.value)
                          }
                          aria-label={`Rename ${head.name}`}
                        />
                        <button
                          className="primary-btn"
                          disabled={
                            updateHead.isPending || !editingHeadName.trim()
                          }
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="quiet-btn"
                          onClick={() => {
                            setEditingHeadId(null);
                            setEditingHeadName("");
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="expense-head-row-copy">
                          <b>{head.name}</b>
                          <small>{Number(head.usage)} expenses</small>
                        </div>
                        <div className="expense-head-row-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            title={`Rename ${head.name}`}
                            aria-label={`Rename ${head.name}`}
                            onClick={() => {
                              setEditingHeadId(head.id);
                              setEditingHeadName(head.name);
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger-icon"
                            title={
                              Number(head.usage) > 0
                                ? "Cannot delete a head used by expenses; rename it instead."
                                : `Delete ${head.name}`
                            }
                            aria-label={`Delete ${head.name}`}
                            disabled={Number(head.usage) > 0}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete the unused expense head “${head.name}”?`
                                )
                              )
                                removeHead.mutate({ id: head.id });
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            <form
              className="expense-head-add"
              onSubmit={event => {
                event.preventDefault();
                addHead.mutate({ name: headName.trim() });
              }}
            >
              <label>
                Add expense head
                <input
                  required
                  maxLength={80}
                  value={headName}
                  onChange={event => setHeadName(event.target.value)}
                  placeholder="e.g. Advertising"
                />
              </label>
              <button
                className="primary-btn"
                disabled={addHead.isPending || !headName.trim()}
              >
                {addHead.isPending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Plus size={15} />
                )}
                Add head
              </button>
            </form>
            <p className="muted expense-head-note">
              Rename updates existing expense labels. A head in use cannot be
              deleted, preserving its history.
            </p>
          </div>
        </WorkspaceModal>
      )}

      {draft && (
        <WorkspaceModal
          title={draft.id ? "Edit expense" : "Add expense"}
          subtitle="Record the cost, who paid it and whether reimbursement is still due."
          onClose={() => setDraft(null)}
          wide
        >
          <form className="expense-form" onSubmit={submit}>
            <div className="expense-form-grid">
              <label>
                Amount
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
                Expense date
                <input
                  type="date"
                  required
                  value={draft.date}
                  onChange={event =>
                    setDraft({ ...draft, date: event.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Purpose
              <input
                maxLength={500}
                required
                value={draft.purpose}
                onChange={event =>
                  setDraft({ ...draft, purpose: event.target.value })
                }
                placeholder="What was this expense for?"
              />
            </label>
            <div className="expense-form-grid">
              <label>
                Expense type
                <select
                  value={draft.kind}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      kind: event.target.value as ExpenseDraft["kind"],
                      invoiceId: "",
                    })
                  }
                >
                  <option value="invoice">Invoice expense</option>
                  <option value="other">Other expense</option>
                </select>
              </label>
              <label>
                Paid by
                <input
                  list="billflow-expense-payers"
                  required
                  maxLength={180}
                  value={draft.paidBy}
                  onChange={event =>
                    setDraft({ ...draft, paidBy: event.target.value })
                  }
                  placeholder="Type a name, e.g. Prayas"
                />
                <datalist id="billflow-expense-payers">
                  {payerNames.map(name => (
                    <option value={name} key={name} />
                  ))}
                </datalist>
              </label>
            </div>
            {draft.kind === "invoice" ? (
              <label>
                Invoice
                <select
                  required
                  value={draft.invoiceId}
                  onChange={event =>
                    setDraft({ ...draft, invoiceId: event.target.value })
                  }
                >
                  <option value="">Select invoice</option>
                  {invoices.map((row: any) => {
                    const invoice = row.document ?? row;
                    return (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.number} · {row.customer?.name ?? "Customer"}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : (
              <div className="expense-form-grid">
                <label>
                  Category
                  <select
                    value={draft.category}
                    onChange={event =>
                      setDraft({
                        ...draft,
                        category: event.target
                          .value as ExpenseDraft["category"],
                      })
                    }
                  >
                    {availableCategories.map(category => (
                      <option value={category} key={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="expense-form-grid">
              <label>
                Reimbursement status
                <select
                  value={draft.reimbursementStatus}
                  onChange={event => {
                    const reimbursementStatus = event.target.value as
                      | "paid"
                      | "due";
                    setDraft({
                      ...draft,
                      reimbursementStatus,
                      reimbursedDate:
                        reimbursementStatus === "paid"
                          ? draft.reimbursedDate || today()
                          : "",
                    });
                  }}
                >
                  <option value="due">Due — awaiting reimbursement</option>
                  <option value="paid">Paid — reimbursed</option>
                </select>
              </label>
              {draft.reimbursementStatus === "due" ? (
                <label>
                  Reimbursement due date
                  <input
                    type="date"
                    required
                    value={draft.reimbursementDueDate}
                    onChange={event =>
                      setDraft({
                        ...draft,
                        reimbursementDueDate: event.target.value,
                      })
                    }
                  />
                  <small className="expense-field-hint">
                    Automatically shows Overdue after this date passes.
                  </small>
                </label>
              ) : (
                <label>
                  Paid / reimbursed date
                  <input
                    type="date"
                    value={draft.reimbursedDate}
                    onChange={event =>
                      setDraft({ ...draft, reimbursedDate: event.target.value })
                    }
                  />
                  <small className="expense-field-hint">
                    Existing expenses may have no recorded reimbursement date.
                  </small>
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="quiet-btn"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button className="primary-btn" disabled={save.isPending}>
                {save.isPending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Plus size={15} />
                )}
                {draft.id ? "Save changes" : "Save expense"}
              </button>
            </div>
          </form>
        </WorkspaceModal>
      )}

      {explorePayer && (
        <WorkspaceModal
          title={`Expenses by ${explorePayer}`}
          subtitle="Review the expenses, reimbursement status and due-date history for this payer."
          onClose={() => setExplorePayer(null)}
          wide
        >
          <div className="payer-detail-summary">
            <div>
              <span>Invoice expenses</span>
              <b>
                {money(
                  (detailData.data?.entries ?? []).reduce(
                    (sum: number, row: any) =>
                      sum +
                      (row.expense.kind === "invoice"
                        ? Number(row.expense.amount)
                        : 0),
                    0
                  ),
                  currency
                )}
              </b>
            </div>
            <div>
              <span>Other expenses</span>
              <b>
                {money(
                  (detailData.data?.entries ?? []).reduce(
                    (sum: number, row: any) =>
                      sum +
                      (row.expense.kind === "other"
                        ? Number(row.expense.amount)
                        : 0),
                    0
                  ),
                  currency
                )}
              </b>
            </div>
            <div>
              <span>Pending reimbursement</span>
              <b>
                {money(
                  (detailData.data?.entries ?? []).reduce(
                    (sum: number, row: any) =>
                      sum +
                      (resolveExpenseReimbursementStatus(
                        row.expense.reimbursementStatus ?? "paid",
                        row.expense.reimbursementDueDate,
                        todayKey
                      ) !== "paid"
                        ? Number(row.expense.amount)
                        : 0),
                    0
                  ),
                  currency
                )}
              </b>
            </div>
            <div>
              <span>Overdue reimbursement</span>
              <b className="expense-overdue-value">
                {money(
                  (detailData.data?.entries ?? []).reduce(
                    (sum: number, row: any) =>
                      sum +
                      (resolveExpenseReimbursementStatus(
                        row.expense.reimbursementStatus ?? "paid",
                        row.expense.reimbursementDueDate,
                        todayKey
                      ) === "overdue"
                        ? Number(row.expense.amount)
                        : 0),
                    0
                  ),
                  currency
                )}
              </b>
            </div>
          </div>
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>EXPENSE PURPOSE</th>
                  <th>TYPE</th>
                  <th>INVOICE / CATEGORY</th>
                  <th>REIMBURSEMENT</th>
                  <th className="right">AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {detailData.data?.entries.map((row: any) => {
                  const expense = row.expense;
                  const status = resolveExpenseReimbursementStatus(
                    expense.reimbursementStatus ?? "paid",
                    expense.reimbursementDueDate,
                    todayKey
                  );
                  return (
                    <tr key={expense.id}>
                      <td>{formatExpenseDate(expense.date)}</td>
                      <td>{expense.purpose}</td>
                      <td>
                        {expense.kind === "invoice"
                          ? "Invoice expense"
                          : "Other expense"}
                      </td>
                      <td>
                        {row.invoice?.number
                          ? `${row.invoice.number} · ${row.customer?.name ?? ""}`
                          : expense.category || "—"}
                      </td>
                      <td>
                        <ReimbursementCell
                          status={status}
                          dueDate={expense.reimbursementDueDate}
                          reimbursedDate={expense.reimbursedDate}
                        />
                      </td>
                      <td className="right">
                        {money(expense.amount, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {detailData.isLoading && (
              <div className="table-loading">
                <LoaderCircle className="spin" size={18} /> Loading detail…
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button className="quiet-btn" onClick={() => setExplorePayer(null)}>
              <X size={14} /> Close detail
            </button>
          </div>
        </WorkspaceModal>
      )}
    </section>
  );
}

function formatExpenseDate(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ReimbursementCell({
  status,
  dueDate,
  reimbursedDate,
}: {
  status: "paid" | "due" | "overdue";
  dueDate?: string | null;
  reimbursedDate?: string | null;
}) {
  const Icon =
    status === "paid"
      ? CircleCheck
      : status === "overdue"
        ? CircleAlert
        : Clock3;
  const label =
    status === "paid" ? "Paid" : status === "overdue" ? "Overdue" : "Due";
  const detail =
    status === "paid"
      ? reimbursedDate
        ? `Reimbursed ${formatExpenseDate(reimbursedDate)}`
        : "Reimbursement date not recorded"
      : status === "overdue"
        ? `Was due ${formatExpenseDate(dueDate)}`
        : `Due ${formatExpenseDate(dueDate)}`;

  return (
    <div className={`reimbursement-cell state-${status}`}>
      <span className="reimbursement-state-pill">
        <Icon size={12} aria-hidden="true" />
        {label}
      </span>
      <small>{detail}</small>
    </div>
  );
}

function ExpenseMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: any;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`expense-icon tone-${tone}`}>
          <Icon size={16} />
        </span>
      </div>
      <strong className="metric-value">{value}</strong>
      <div className="metric-bottom">
        <span className="metric-detail">{detail}</span>
      </div>
    </article>
  );
}
