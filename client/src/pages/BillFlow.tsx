import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  BadgeIndianRupee,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Eye,
  FileChartColumnIncreasing,
  FileCog,
  FilePlus2,
  FileText,
  Filter,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  TrendingUp,
  Truck,
  UserRound,
  UserRoundPlus,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExpensesPanel } from "@/components/billflow/ExpensesPanel";
import { BankReceiptsPanel } from "@/components/billflow/BankReceiptsPanel";
import { ChallansPanel } from "@/components/billflow/ChallansPanel";
import { InvoiceFormatPanel } from "@/components/billflow/InvoiceFormatPanel";
import { DocumentPreview } from "@/components/billflow/DocumentPreview";
import { getPeriodRange, type PeriodPreset } from "@/lib/periodRange";

type PageKey =
  | "Dashboard"
  | "Invoices"
  | "Quotations"
  | "Delivery Challans"
  | "Customers"
  | "Payments"
  | "Expenses"
  | "Reports"
  | "Bank Receipts"
  | "Invoice Format"
  | "Users"
  | "Settings";
const nav: { label: PageKey; icon: typeof LayoutDashboard }[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Invoices", icon: FileText },
  { label: "Quotations", icon: FileChartColumnIncreasing },
  { label: "Delivery Challans", icon: Truck },
  { label: "Customers", icon: UserRound },
  { label: "Payments", icon: Wallet },
  { label: "Expenses", icon: BadgeIndianRupee },
  { label: "Reports", icon: ChartNoAxesCombined },
  { label: "Bank Receipts", icon: CreditCard },
  { label: "Invoice Format", icon: FileCog },
  { label: "Users", icon: Users },
  { label: "Settings", icon: Settings },
];
const money = (n: unknown, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
const fmtDate = (d?: string | null) =>
  d
    ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(
        "en-IN",
        { day: "2-digit", month: "short", year: "numeric" }
      )
    : "—";
const dateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const today = () => dateOnly(new Date());
const cn = (...v: (string | false | undefined | null)[]) =>
  v.filter(Boolean).join(" ");

function AuthView() {
  const invitation =
    new URLSearchParams(window.location.search).get("invite") ?? "";
  const [mode, setMode] = useState<"login" | "signup" | "invite">(
    invitation ? "invite" : "login"
  );
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: e => toast.error(e.message),
  });
  const signup = trpc.auth.signup.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: e => toast.error(e.message),
  });
  const accept = trpc.auth.acceptInvite.useMutation({
    onSuccess: () => {
      window.history.replaceState({}, "", "/");
      utils.auth.me.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const busy = login.isPending || signup.isPending || accept.isPending;
  return (
    <main className="auth-screen">
      <div className="auth-glow" />
      <section className="auth-card">
        <div className="brand-mark">
          <Zap size={21} fill="currentColor" />
        </div>
        <div className="eyebrow">BILLING, IN CLEAR FOCUS</div>
        <h1>
          {mode === "login"
            ? "Sign in to BillFlow"
            : mode === "invite"
              ? "Join the workspace"
              : "Create your workspace"}
        </h1>
        <p className="muted">
          {mode === "invite"
            ? "Accept your invitation and set a password for secure access."
            : "A calm command centre for invoices, collections, and customer relationships."}
        </p>
        <form
          className="auth-form"
          onSubmit={e => {
            e.preventDefault();
            if (mode === "login") login.mutate({ email, password });
            else if (mode === "invite")
              accept.mutate({ token: invitation, name, password });
            else signup.mutate({ name, companyName: company, email, password });
          }}
        >
          {mode !== "login" && (
            <>
              <label>
                Your name
                <input
                  autoComplete="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  minLength={2}
                  placeholder="Prayas Chakraborty"
                />
              </label>
              {mode === "signup" && (
                <label>
                  Business name
                  <input
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    required
                    minLength={2}
                    placeholder="Acme Studio"
                  />
                </label>
              )}
            </>
          )}
          {mode !== "invite" && (
            <label>
              Work email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
              />
            </label>
          )}
          <label>
            Password
            <input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={mode !== "login" ? 10 : 1}
              placeholder={
                mode === "login" ? "••••••••••" : "At least 10 characters"
              }
            />
          </label>
          <button className="primary-btn wide" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : mode === "login" ? (
              "Sign in"
            ) : mode === "invite" ? (
              "Accept invitation"
            ) : (
              "Create account"
            )}
            <ArrowRight size={17} />
          </button>
        </form>
        {mode === "invite" ? (
          <button
            className="auth-toggle"
            onClick={() => {
              window.history.replaceState({}, "", "/");
              setMode("login");
            }}
          >
            Back to sign in
          </button>
        ) : (
          <button
            className="auth-toggle"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login"
              ? "New to BillFlow? Create your workspace"
              : "Already have an account? Sign in"}
          </button>
        )}
        <div className="auth-security">
          <Shield size={14} /> Secure, private company workspace <span>·</span>{" "}
          INR ready
        </div>
      </section>
      <div className="auth-footer">
        BILLFLOW <span>•</span> FINANCE, IN FLOW
      </div>
    </main>
  );
}

function Status({ value }: { value: string }) {
  const s = value.toLowerCase();
  return <span className={`status status-${s}`}>{s.replaceAll("_", " ")}</span>;
}
function IconTile({
  children,
  tone = "teal",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <div className={`icon-tile tone-${tone}`}>{children}</div>;
}
function Empty({
  icon: Icon = FileText,
  title,
  copy,
  button,
}: {
  icon?: typeof FileText;
  title: string;
  copy: string;
  button?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={21} />
      </div>
      <h3>{title}</h3>
      <p>{copy}</p>
      {button}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={cn("modal-panel", wide && "modal-wide")}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-heading">
          <div>
            <div className="eyebrow">BILLFLOW WORKSPACE</div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function DocumentForm({
  kind,
  customers,
  onClose,
  onSaved,
}: {
  kind: "invoice" | "quotation";
  customers: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">(
    "amount"
  );
  const [items, setItems] = useState([
    { name: "", quantity: "1", rate: "0", taxPercent: "0" },
  ]);
  const save = trpc.documents.save.useMutation({
    onSuccess: () => {
      toast.success(
        `${kind === "invoice" ? "Invoice" : "Quotation"} saved as a draft`
      );
      onSaved();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  const totals = useMemo(() => {
    const sub = items.reduce(
      (s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0),
      0
    );
    const tax = items.reduce(
      (s, i) =>
        s +
        ((Number(i.quantity) || 0) *
          (Number(i.rate) || 0) *
          (Number(i.taxPercent) || 0)) /
          100,
      0
    );
    const raw = sub + tax;
    const disc = Math.min(
      raw,
      discountMode === "percent"
        ? (raw * (Number(discount) || 0)) / 100
        : Number(discount) || 0
    );
    return { sub, tax, total: Math.max(0, raw - disc) };
  }, [items, discount, discountMode]);
  const upd = (idx: number, key: string, val: string) =>
    setItems(
      items.map((item, i) => (i === idx ? { ...item, [key]: val } : item))
    );
  return (
    <Modal
      title={`New ${kind}`}
      subtitle="Add the essentials. Totals update as you work."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={e => {
          e.preventDefault();
          save.mutate({
            kind,
            customerId: Number(customerId),
            issueDate: today(),
            dueDate: dueDate || undefined,
            notes,
            discount: Number(discount) || 0,
            discountMode,
            items: items.map(i => ({
              name: i.name,
              quantity: Number(i.quantity),
              rate: Number(i.rate),
              taxPercent: Number(i.taxPercent),
            })),
          });
        }}
      >
        <div className="form-grid">
          <label>
            Customer
            <select
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              required
            >
              <option value="">Select customer</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </label>
        </div>
        <div className="line-items-head">
          <div>
            <h3>Line items</h3>
            <span>Name, quantity, rate and tax</span>
          </div>
          <button
            type="button"
            className="quiet-btn"
            onClick={() =>
              setItems([
                ...items,
                { name: "", quantity: "1", rate: "0", taxPercent: "0" },
              ])
            }
          >
            <Plus size={15} /> Add line
          </button>
        </div>
        <div className="line-items-editor">
          {items.map((item, i) => (
            <div className="line-edit-row" key={i}>
              <input
                value={item.name}
                onChange={e => upd(i, "name", e.target.value)}
                placeholder="Service or product"
                required
              />
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={item.quantity}
                onChange={e => upd(i, "quantity", e.target.value)}
                aria-label="Quantity"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={item.rate}
                onChange={e => upd(i, "rate", e.target.value)}
                aria-label="Rate"
              />
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={item.taxPercent}
                onChange={e => upd(i, "taxPercent", e.target.value)}
                aria-label="Tax percent"
              />
              <button
                type="button"
                className="icon-btn danger-icon"
                aria-label="Remove line"
                onClick={() =>
                  setItems(
                    items.length > 1 ? items.filter((_, j) => j !== i) : items
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="line-item-labels">
          <span>Item</span>
          <span>Qty</span>
          <span>Rate</span>
          <span>Tax %</span>
          <span></span>
        </div>
        <div className="form-grid">
          <label>
            Discount
            <select
              value={discountMode}
              onChange={e =>
                setDiscountMode(e.target.value as "amount" | "percent")
              }
            >
              <option value="amount">Fixed amount</option>
              <option value="percent">Percentage</option>
            </select>
          </label>
          <label>
            Discount value
            <input
              type="number"
              min="0"
              value={discount}
              onChange={e => setDiscount(e.target.value)}
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            rows={3}
            maxLength={6000}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Payment terms or a short note for your customer"
          />
        </label>
        <div className="totals-strip">
          <div>
            <span>Subtotal</span>
            <b>{money(totals.sub)}</b>
          </div>
          <div>
            <span>Tax</span>
            <b>{money(totals.tax)}</b>
          </div>
          <div className="total-final">
            <span>Total</span>
            <b>{money(totals.total)}</b>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="quiet-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={save.isPending || !customerId}
          >
            {save.isPending ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            Save draft
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    taxId: initial?.taxId ?? "",
    address: initial?.address ?? "",
  });
  const save = trpc.customers.save.useMutation({
    onSuccess: () => {
      toast.success(initial ? "Customer updated" : "Customer added");
      onSaved();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Modal title={initial ? "Edit customer" : "Add customer"} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={e => {
          e.preventDefault();
          save.mutate({ ...v, id: initial?.id });
        }}
      >
        <label>
          Customer name
          <input
            required
            value={v.name}
            onChange={e => setV({ ...v, name: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Email
            <input
              type="email"
              value={v.email}
              onChange={e => setV({ ...v, email: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              value={v.phone}
              onChange={e => setV({ ...v, phone: e.target.value })}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Tax ID / GSTIN
            <input
              value={v.taxId}
              onChange={e => setV({ ...v, taxId: e.target.value })}
            />
          </label>
          <label>
            Address
            <input
              value={v.address}
              onChange={e => setV({ ...v, address: e.target.value })}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="quiet-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={save.isPending}>
            Save customer
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecordPayment({
  invoices,
  onClose,
  onSaved,
}: {
  invoices: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState("");
  const [amountValue, setAmount] = useState("");
  const [paymentDate, setDate] = useState(today());
  const [mode, setMode] = useState("bank_transfer");
  const add = trpc.payments.add.useMutation({
    onSuccess: () => {
      toast.success("Payment recorded");
      onSaved();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Modal
      title="Record payment"
      subtitle="Payments immediately update the invoice balance and status."
      onClose={onClose}
    >
      <form
        className="stack-form"
        onSubmit={e => {
          e.preventDefault();
          add.mutate({
            documentId: Number(id),
            amount: Number(amountValue),
            paymentDate,
            mode: mode as any,
          });
        }}
      >
        <label>
          Invoice
          <select value={id} onChange={e => setId(e.target.value)} required>
            <option value="">Select invoice</option>
            {invoices.map(r => {
              const d = r.document ?? r;
              return (
                <option key={d.id} value={d.id}>
                  {d.number} · {r.customer?.name ?? "Customer"} ·{" "}
                  {money(Number(d.total) - Number(d.amountPaid))} due
                </option>
              );
            })}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Amount
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amountValue}
              onChange={e => setAmount(e.target.value)}
              required
            />
          </label>
          <label>
            Payment date
            <input
              type="date"
              value={paymentDate}
              onChange={e => setDate(e.target.value)}
              required
            />
          </label>
        </div>
        <label>
          Mode
          <select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="upi">UPI</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="quiet-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!id || add.isPending}>
            Log payment
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function BillFlow() {
  const auth = trpc.auth.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => utils.auth.me.setData(undefined, null),
  });
  const [page, setPage] = useState<PageKey>("Dashboard");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<
    "invoice" | "quotation" | "customer" | "payment" | "invite" | null
  >(null);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [todayKey, setTodayKey] = useState(today);
  const [customFrom, setCustomFrom] = useState(
    () => `${today().slice(0, 7)}-01`
  );
  const [customTo, setCustomTo] = useState(today);
  const [customerFilter, setCustomerFilter] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(today()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (auth.data && auth.data.role !== "admin" && page === "Users")
      setPage("Dashboard");
  }, [auth.data?.role, page]);
  const selectedRange = getPeriodRange(period, todayKey, customFrom, customTo);
  const periodLabel =
    period === "month"
      ? "This month"
      : period === "quarter"
        ? "Quarter to date"
        : period === "fy"
          ? "FY to date"
          : "Custom range";
  const periodDisplay = `${periodLabel} · ${fmtDate(selectedRange.from)} – ${fmtDate(selectedRange.to)}`;
  const showSharedPeriod = !["Bank Receipts", "Invoice Format"].includes(page);
  const overview = trpc.dashboard.overview.useQuery(
    {
      from: selectedRange.from,
      to: selectedRange.to,
      asOfDate: selectedRange.to,
    },
    {
      enabled: !!auth.data && ["Dashboard", "Reports"].includes(page),
    }
  );
  const customers = trpc.customers.list.useQuery(
    { search: search || undefined },
    { enabled: !!auth.data }
  );
  const invoices = trpc.documents.list.useQuery(
    {
      kind: "invoice",
      status: filterStatus,
      search: search || undefined,
      from: selectedRange.from,
      to: selectedRange.to,
      customerId: customerFilter ? Number(customerFilter) : undefined,
    },
    { enabled: !!auth.data && page === "Invoices" }
  );
  const paymentInvoices = trpc.documents.list.useQuery(
    { kind: "invoice" },
    { enabled: !!auth.data && modal === "payment" }
  );
  const expenseInvoices = trpc.documents.list.useQuery(
    { kind: "invoice" },
    { enabled: !!auth.data && page === "Expenses" }
  );
  const quotes = trpc.documents.list.useQuery(
    {
      kind: "quotation",
      search: search || undefined,
      from: selectedRange.from,
      to: selectedRange.to,
    },
    { enabled: !!auth.data && page === "Quotations" }
  );
  const allPayments = trpc.payments.list.useQuery(selectedRange, {
    enabled: !!auth.data && page === "Payments",
  });
  const users = trpc.users.list.useQuery(selectedRange, {
    enabled: auth.data?.role === "admin" && page === "Users",
  });
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: !!auth.data && page === "Settings",
  });
  const notices = trpc.notifications.logs.useQuery(selectedRange, {
    enabled: !!auth.data && page === "Settings",
  });

  const toggleMember = trpc.users.setActive.useMutation({
    onSuccess: () => users.refetch(),
    onError: e => toast.error(e.message),
  });
  const invite = trpc.users.invite.useMutation({
    onSuccess: () => {
      toast.success("Invitation sent");
      users.refetch();
      setModal(null);
    },
    onError: e => toast.error(e.message),
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"accountant" | "viewer">(
    "accountant"
  );
  const ledger = trpc.customers.ledger.useQuery(
    {
      customerId: selectedCustomer || 0,
      from: selectedRange.from,
      to: selectedRange.to,
    },
    { enabled: !!selectedCustomer }
  );
  const sendDoc = trpc.documents.send.useMutation({
    onSuccess: () => {
      toast.success("Email accepted by delivery server");
      utils.documents.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const convert = trpc.documents.convert.useMutation({
    onSuccess: r => {
      toast.success(`Created ${r.number}`);
      utils.documents.list.invalidate();
      setPage("Invoices");
    },
    onError: e => toast.error(e.message),
  });
  const status = trpc.documents.setStatus.useMutation({
    onSuccess: () => utils.documents.list.invalidate(),
    onError: e => toast.error(e.message),
  });
  const remove = trpc.documents.remove.useMutation({
    onSuccess: () => {
      toast.success("Invoice deleted");
      utils.documents.list.invalidate();
      utils.dashboard.overview.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  if (auth.isLoading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Zap size={20} />
        </div>
        <LoaderCircle className="spin" size={20} />
      </div>
    );
  if (!auth.data) return <AuthView />;
  const me = auth.data;
  const visibleNav =
    me.role === "admin" ? nav : nav.filter(({ label }) => label !== "Users");
  const currencyCode = me.company.currency;
  const activeTitle = page === "Dashboard" ? "Command centre" : page;
  const greeting =
    new Date().getHours() < 12
      ? "Good morning"
      : new Date().getHours() < 18
        ? "Good afternoon"
        : "Good evening";
  const refreshAll = () => {
    utils.documents.list.invalidate();
    utils.dashboard.overview.invalidate();
    utils.payments.list.invalidate();
    utils.customers.list.invalidate();
    utils.expenses.list.invalidate();
    utils.challans.list.invalidate();
  };
  const setActivePage = (p: PageKey) => {
    setPage(p === "Users" && me.role !== "admin" ? "Dashboard" : p);
    setMobileNav(false);
    setSearch("");
  };
  const printInvoice = async (id: number) => {
    const result = await utils.documents.detail.fetch({ id });
    setPreviewDoc(result);
  };
  const openDoc = (kind: "invoice" | "quotation") => {
    if (!customers.data?.length) {
      toast.message("Add a customer first, then create a document.");
      setPage("Customers");
      return;
    }
    setModal(kind);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Zap size={20} fill="currentColor" />
          </div>
          <div>
            <div className="brand-name">BillFlow</div>
            <div className="brand-caption">INVOICE OS</div>
          </div>
          <span className="brand-live" />
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav">
          {visibleNav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={cn("nav-item", page === label && "active")}
              onClick={() => setActivePage(label)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {label === "Invoices" &&
                (overview.data?.metrics.overdueCount ?? 0) > 0 && (
                  <i className="nav-alert" />
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="workspace-chip">
          <div className="workspace-chip-icon">
            <Zap size={15} />
          </div>
          <div>
            <b>BUSINESS WORKSPACE</b>
            <span>{me.company.currency} · team access</span>
          </div>
        </div>
        <div className="profile-row">
          <div className="avatar">{me.name.slice(0, 1).toUpperCase()}</div>
          <div className="profile-copy">
            <b>{me.name}</b>
            <span>{me.role.toUpperCase()}</span>
          </div>
          <button
            className="icon-btn profile-logout"
            title="Sign out"
            onClick={() => logout.mutate()}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className={cn("mobile-top", mobileNav && "mobile-open")}>
        <div className="mobile-brand">
          <div className="brand-mark">
            <Zap size={17} />
          </div>
          <b>BillFlow</b>
        </div>
        <button
          className="icon-btn"
          onClick={() => setMobileNav(!mobileNav)}
          aria-label="Toggle navigation"
        >
          {mobileNav ? <X /> : <Menu />}
        </button>
      </div>
      {mobileNav && (
        <div className="mobile-nav">
          {visibleNav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={cn("nav-item", page === label && "active")}
              onClick={() => setActivePage(label)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </div>
      )}
      <main className="main-content">
        <header className="page-top">
          <div>
            <div className="eyebrow">
              <span className="pulse-dot" /> {activeTitle.toUpperCase()}
            </div>
            <h1>
              {page === "Dashboard"
                ? `${greeting}, ${me.name.split(" ")[0]}`
                : page}
            </h1>
            <p className="period-line">
              {page === "Bank Receipts" ? (
                "Choose a bank statement period below."
              ) : showSharedPeriod ? (
                <>
                  Period: <strong>{fmtDate(selectedRange.from)}</strong>
                  <span>→</span>
                  <strong>{fmtDate(selectedRange.to)}</strong>
                </>
              ) : (
                "Workspace configuration and access"
              )}
            </p>
          </div>
          <div className="top-actions">
            {showSharedPeriod && (
              <div className="period-control-stack">
                <div className="period-switch" aria-label="Reporting period">
                  <button
                    className={cn(period === "month" && "selected")}
                    onClick={() => setPeriod("month")}
                    aria-pressed={period === "month"}
                  >
                    This month
                  </button>
                  <button
                    className={cn(period === "quarter" && "selected")}
                    onClick={() => setPeriod("quarter")}
                    aria-pressed={period === "quarter"}
                  >
                    Quarter
                  </button>
                  <button
                    className={cn(period === "fy" && "selected")}
                    onClick={() => setPeriod("fy")}
                    aria-pressed={period === "fy"}
                  >
                    FY
                  </button>
                  <button
                    className={cn(period === "custom" && "selected")}
                    onClick={() => setPeriod("custom")}
                    aria-pressed={period === "custom"}
                  >
                    Custom
                  </button>
                </div>
                {period === "custom" && (
                  <div className="period-custom-range">
                    <label>
                      <span>From</span>
                      <input
                        type="date"
                        aria-label="Custom period start date"
                        value={customFrom}
                        onChange={event => {
                          const value = event.target.value;
                          setCustomFrom(value);
                          if (value && customTo && value > customTo)
                            setCustomTo(value);
                        }}
                      />
                    </label>
                    <label>
                      <span>To</span>
                      <input
                        type="date"
                        aria-label="Custom period end date"
                        value={customTo}
                        onChange={event => {
                          const value = event.target.value;
                          setCustomTo(value);
                          if (value && customFrom && value < customFrom)
                            setCustomFrom(value);
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
            <button
              className="icon-btn notification-btn"
              aria-label="Notifications"
              onClick={() => setActivePage("Settings")}
            >
              <Bell size={18} />
              {(overview.data?.notices?.length ?? 0) > 0 && <i />}
            </button>
            {page !== "Bank Receipts" && (
              <button
                className="primary-btn top-create"
                onClick={() => openDoc("invoice")}
              >
                <Plus size={17} /> New invoice
              </button>
            )}
          </div>
        </header>
        {page === "Dashboard" && (
          <DashboardView
            data={overview.data}
            loading={overview.isLoading}
            currency={currencyCode}
            periodLabel={periodLabel}
            onPage={setActivePage}
            onPayment={() => setModal("payment")}
            onCreate={() => openDoc("invoice")}
            onReminder={id => sendDoc.mutate({ id, kind: "reminder" })}
          />
        )}
        {page === "Invoices" && (
          <section className="section-panel">
            <div className="section-toolbar">
              <div>
                <div className="eyebrow">RECEIVABLES</div>
                <h2>
                  Invoices{" "}
                  <span className="count-chip">
                    {invoices.data?.length ?? 0}
                  </span>
                </h2>
                <p>Track every invoice from draft through settlement.</p>
              </div>
              <div className="toolbar-actions">
                <button
                  className="quiet-btn"
                  onClick={() => setModal("payment")}
                >
                  <Wallet size={15} /> Record payment
                </button>
                <button
                  className="primary-btn"
                  onClick={() => openDoc("invoice")}
                >
                  <Plus size={16} /> Create invoice
                </button>
              </div>
            </div>
            <div className="table-filters">
              <div className="search-box">
                <Search size={16} />
                <input
                  placeholder="Search number or customer"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                {[
                  "draft",
                  "sent",
                  "partially_paid",
                  "paid",
                  "overdue",
                  "on_hold",
                ].map(s => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <select
                value={customerFilter}
                onChange={e => setCustomerFilter(e.target.value)}
              >
                <option value="">All customers</option>
                {customers.data?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="filter-label global-period-caption">
                <CalendarDays size={14} /> {periodDisplay}
              </span>
            </div>
            <DocumentTable
              rows={invoices.data ?? []}
              loading={invoices.isLoading}
              currency={currencyCode}
              onSend={id => sendDoc.mutate({ id, kind: "invoice" })}
              onReminder={id => sendDoc.mutate({ id, kind: "reminder" })}
              onPay={() => setModal("payment")}
              onPrint={printInvoice}
              onStatus={(id, s) => status.mutate({ id, status: s as any })}
              onDelete={id => {
                if (
                  window.confirm(
                    "Delete this unpaid invoice and its line items?"
                  )
                )
                  remove.mutate({ id });
              }}
            />
            {invoices.data?.length === 0 && !invoices.isLoading && (
              <Empty
                icon={FileText}
                title="No invoices match this view"
                copy="Create an invoice or adjust the filters to see your records."
                button={
                  <button
                    className="primary-btn"
                    onClick={() => openDoc("invoice")}
                  >
                    <Plus size={15} /> Create invoice
                  </button>
                }
              />
            )}
          </section>
        )}
        {page === "Quotations" && (
          <section className="section-panel">
            <div className="section-toolbar">
              <div>
                <div className="eyebrow">PROPOSALS</div>
                <h2>
                  Quotations{" "}
                  <span className="count-chip">{quotes.data?.length ?? 0}</span>
                </h2>
                <p>
                  Shape a proposal, then convert it to an invoice when approved.
                </p>
              </div>
              <button
                className="primary-btn"
                onClick={() => openDoc("quotation")}
              >
                <Plus size={16} /> New quotation
              </button>
            </div>
            <DocumentTable
              rows={quotes.data ?? []}
              loading={quotes.isLoading}
              currency={currencyCode}
              onSend={id => sendDoc.mutate({ id, kind: "invoice" })}
              onReminder={() => {}}
              onPay={() => {}}
              onPrint={printInvoice}
              onStatus={(id, s) => status.mutate({ id, status: s as any })}
              onDelete={id => remove.mutate({ id })}
              quotation
              onConvert={id => convert.mutate({ id })}
            />
            {quotes.data?.length === 0 && !quotes.isLoading && (
              <Empty
                icon={FileChartColumnIncreasing}
                title="No quotations yet"
                copy="Put your next proposal together in a few steps."
                button={
                  <button
                    className="primary-btn"
                    onClick={() => openDoc("quotation")}
                  >
                    <Plus size={15} /> Create quotation
                  </button>
                }
              />
            )}
          </section>
        )}
        {page === "Customers" && (
          <section className="section-panel">
            <div className="section-toolbar">
              <div>
                <div className="eyebrow">RELATIONSHIPS</div>
                <h2>
                  Customers{" "}
                  <span className="count-chip">
                    {customers.data?.length ?? 0}
                  </span>
                </h2>
                <p>
                  Customer details and a clear view of every outstanding
                  balance.
                </p>
              </div>
              <button
                className="primary-btn"
                onClick={() => {
                  setEditingCustomer(null);
                  setModal("customer");
                }}
              >
                <Plus size={16} /> Add customer
              </button>
            </div>
            <div className="table-filters">
              <div className="search-box">
                <Search size={16} />
                <input
                  placeholder="Search customers"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="customer-grid">
              {customers.data?.map((c: any) => (
                <article className="customer-card" key={c.id}>
                  <div className="customer-top">
                    <div className="customer-avatar">{c.name.slice(0, 1)}</div>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setEditingCustomer(c);
                        setModal("customer");
                      }}
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                  </div>
                  <h3>{c.name}</h3>
                  <p className="customer-email">
                    {c.email || "No email address"}
                  </p>
                  <div className="customer-meta">
                    <span>{c.phone || "Phone not set"}</span>
                    <span>{c.taxId || "Tax ID not set"}</span>
                  </div>
                  <button
                    className="ledger-link"
                    onClick={() => setSelectedCustomer(c.id)}
                  >
                    View ledger <ArrowRight size={14} />
                  </button>
                </article>
              ))}
            </div>
            {!customers.isLoading && !customers.data?.length && (
              <Empty
                icon={Users}
                title="Your customer list starts here"
                copy="Save customer contact and tax details once, then reuse them on every document."
                button={
                  <button
                    className="primary-btn"
                    onClick={() => setModal("customer")}
                  >
                    <Plus size={15} /> Add customer
                  </button>
                }
              />
            )}
          </section>
        )}
        {page === "Payments" && (
          <section className="section-panel">
            <div className="section-toolbar">
              <div>
                <div className="eyebrow">CASH APPLICATION</div>
                <h2>
                  Payments{" "}
                  <span className="count-chip">
                    {allPayments.data?.length ?? 0}
                  </span>
                </h2>
                <p>
                  Payments are linked to invoices and automatically update their
                  balance.
                </p>
              </div>
              <button
                className="primary-btn"
                onClick={() => setModal("payment")}
              >
                <Plus size={16} /> Record payment
              </button>
            </div>
            <div className="table-filters">
              <div className="search-box">
                <Search size={16} />
                <input
                  placeholder="Search invoice or customer"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>INVOICE</th>
                    <th>CUSTOMER</th>
                    <th>METHOD</th>
                    <th>REFERENCE</th>
                    <th className="right">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {allPayments.data
                    ?.filter(
                      (r: any) =>
                        !search ||
                        r.document?.number
                          ?.toLowerCase()
                          .includes(search.toLowerCase()) ||
                        r.customer?.name
                          ?.toLowerCase()
                          .includes(search.toLowerCase())
                    )
                    .map((r: any) => (
                      <tr key={r.payment.id}>
                        <td>{fmtDate(r.payment.paymentDate)}</td>
                        <td className="mono bright">{r.document?.number}</td>
                        <td>{r.customer?.name ?? "—"}</td>
                        <td>
                          <span className="payment-mode">
                            <CreditCard size={14} />
                            {r.payment.mode.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>{r.payment.reference || "—"}</td>
                        <td className="right amount-col">
                          {money(r.payment.amount, currencyCode)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!allPayments.isLoading && !allPayments.data?.length && (
              <Empty
                icon={Wallet}
                title="No payments logged"
                copy="Once a customer pays, record the amount, date, and payment mode."
                button={
                  <button
                    className="primary-btn"
                    onClick={() => setModal("payment")}
                  >
                    <Plus size={15} /> Record payment
                  </button>
                }
              />
            )}
          </section>
        )}
        {page === "Expenses" && (
          <ExpensesPanel
            currency={currencyCode}
            invoices={expenseInvoices.data ?? []}
            canEdit={me.role !== "viewer"}
            dateFrom={selectedRange.from}
            dateTo={selectedRange.to}
            periodLabel={periodDisplay}
          />
        )}
        {page === "Delivery Challans" && (
          <ChallansPanel
            customers={customers.data ?? []}
            company={me.company}
            canEdit={me.role !== "viewer"}
            canEditFormat={me.role === "admin"}
            onOpenFormat={() => setPage("Invoice Format")}
            dateFrom={selectedRange.from}
            dateTo={selectedRange.to}
            periodLabel={periodDisplay}
          />
        )}
        {page === "Invoice Format" && (
          <InvoiceFormatPanel canEdit={me.role === "admin"} />
        )}
        {page === "Reports" && (
          <ReportsView
            data={overview.data}
            loading={overview.isLoading}
            currency={currencyCode}
            periodLabel={periodLabel}
          />
        )}
        {page === "Bank Receipts" && (
          <BankReceiptsPanel
            companyName={me.company.name}
            currency={currencyCode}
            canEdit={me.role !== "viewer"}
            isAdmin={me.role === "admin"}
          />
        )}
        {page === "Users" && me.role === "admin" && (
          <section className="section-panel">
            <div className="section-toolbar">
              <div>
                <div className="eyebrow">ACCESS CONTROL</div>
                <h2>People & roles</h2>
                <p>Role-based access scoped to {me.company.name}.</p>
              </div>
              <button
                className="primary-btn"
                onClick={() => setModal("invite")}
              >
                <UserRoundPlus size={16} /> Invite teammate
              </button>
            </div>
            <div className="role-cards">
              <div>
                <Shield size={18} />
                <b>Admin</b>
                <span>Full access · manage workspace</span>
              </div>
              <div>
                <Pencil size={18} />
                <b>Accountant</b>
                <span>Create/edit invoices & payments</span>
              </div>
              <div>
                <UserRound size={18} />
                <b>Viewer</b>
                <span>Read-only access</span>
              </div>
            </div>
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MEMBER</th>
                    <th>ROLE</th>
                    <th>STATUS</th>
                    <th>LAST ACTIVE</th>
                    <th className="right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data?.members.map((u: any) => (
                    <tr key={u.id}>
                      <td>
                        <div className="member-cell">
                          <div className="avatar small-avatar">{u.name[0]}</div>
                          <div>
                            <b>{u.name}</b>
                            <span>{u.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`role-badge role-${u.role}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <span
                          className={cn(
                            "live-status",
                            u.active ? "is-active" : "is-inactive"
                          )}
                        >
                          {u.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        {u.lastSignedIn
                          ? new Date(u.lastSignedIn).toLocaleDateString()
                          : "Not yet"}
                      </td>
                      <td className="right">
                        {u.id !== me.id && (
                          <button
                            className="quiet-btn small-btn"
                            onClick={() =>
                              toggleMember.mutate({
                                id: u.id,
                                active: !u.active,
                              })
                            }
                          >
                            {u.active ? "Deactivate" : "Reactivate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="subsection-heading">
              <div>
                <h3>Recent activity</h3>
                <p>Who changed what in this workspace.</p>
              </div>
            </div>
            <div className="activity-list">
              {users.data?.activity?.slice(0, 8).map((a: any) => (
                <div className="activity-item" key={a.id}>
                  <div className="activity-dot" />
                  <p>
                    <b>{a.actorName}</b> {a.summary}
                  </p>
                  <time>{new Date(a.createdAt).toLocaleDateString()}</time>
                </div>
              ))}
            </div>
          </section>
        )}
        {page === "Settings" && (
          <SettingsView
            settings={settings.data}
            notices={notices.data}
            canEdit={me.role === "admin"}
          />
        )}
        <footer className="app-footer">
          <span>
            BillFlow <b>·</b> invoice OS
          </span>
          <span>FINANCE, IN FLOW</span>
        </footer>
      </main>
      {modal === "invoice" && (
        <DocumentForm
          kind="invoice"
          customers={customers.data ?? []}
          onClose={() => setModal(null)}
          onSaved={refreshAll}
        />
      )}
      {modal === "quotation" && (
        <DocumentForm
          kind="quotation"
          customers={customers.data ?? []}
          onClose={() => setModal(null)}
          onSaved={refreshAll}
        />
      )}
      {modal === "customer" && (
        <CustomerForm
          initial={editingCustomer}
          onClose={() => setModal(null)}
          onSaved={() => utils.customers.list.invalidate()}
        />
      )}
      {modal === "payment" && (
        <RecordPayment
          invoices={paymentInvoices.data ?? []}
          onClose={() => setModal(null)}
          onSaved={refreshAll}
        />
      )}
      {modal === "invite" && (
        <Modal
          title="Invite teammate"
          subtitle="Send a role-based invitation to your company workspace."
          onClose={() => setModal(null)}
        >
          <form
            className="stack-form"
            onSubmit={e => {
              e.preventDefault();
              invite.mutate({ email: inviteEmail, role: inviteRole });
            }}
          >
            <label>
              Email
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </label>
            <label>
              Role
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as any)}
              >
                <option value="accountant">
                  Accountant — invoices & payments
                </option>
                <option value="viewer">Viewer — read only</option>
              </select>
            </label>
            <p className="form-note">
              Invitations expire after seven days. New teammates receive a link
              by email.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="quiet-btn"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="primary-btn" disabled={invite.isPending}>
                <Send size={15} /> Send invite
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selectedCustomer && ledger.data && (
        <Modal
          title={ledger.data.customer.name}
          subtitle={`Customer ledger · outstanding ${money(ledger.data.outstanding, currencyCode)}`}
          onClose={() => setSelectedCustomer(null)}
          wide
        >
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DOCUMENT</th>
                  <th>ISSUED</th>
                  <th>DUE</th>
                  <th>STATUS</th>
                  <th className="right">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.documents.map((d: any) => (
                  <tr key={d.id}>
                    <td className="mono bright">{d.number}</td>
                    <td>{fmtDate(d.issueDate)}</td>
                    <td>{fmtDate(d.dueDate)}</td>
                    <td>
                      <Status value={d.status} />
                    </td>
                    <td className="right">{money(d.total, currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!ledger.data.documents.length && (
            <Empty
              title="No documents yet"
              copy="Invoices and quotations for this customer will appear here."
            />
          )}
        </Modal>
      )}
      {previewDoc && (
        <DocumentPreview
          record={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
}

function SettingsView({
  settings,
  notices,
  canEdit,
}: {
  settings: any;
  notices: any[] | undefined;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [values, setValues] = useState({
    name: "",
    email: "",
    currency: "INR",
    address: "",
    phone: "",
    gstNumber: "",
  });
  useEffect(() => {
    if (settings)
      setValues({
        name: settings.name,
        email: settings.email,
        currency: settings.currency || "INR",
        address: settings.address || "",
        phone: settings.phone || "",
        gstNumber: settings.gstNumber || "",
      });
  }, [settings?.id, settings?.updatedAt]);
  const update = trpc.settings.update.useMutation({
    onSuccess: async () => {
      toast.success("Company settings saved");
      await Promise.all([
        utils.settings.get.invalidate(),
        utils.auth.me.invalidate(),
        utils.dashboard.overview.invalidate(),
        utils.documentFormat.get.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const logo = trpc.documentFormat.uploadLogo.useMutation({
    onSuccess: async () => {
      toast.success("Company logo uploaded");
      await Promise.all([
        utils.auth.me.invalidate(),
        utils.settings.get.invalidate(),
        utils.documentFormat.get.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const resetBusinessData = trpc.settings.resetBusinessData.useMutation({
    onSuccess: async () => {
      setShowResetConfirmation(false);
      setResetPhrase("");
      toast.success(
        "Business data was reset. Invoice, quotation and challan numbering now restart at 001."
      );
      await utils.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 4 * 1024 * 1024
    ) {
      toast.error("Choose a PNG or JPEG logo no larger than 4 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Could not read the logo file.");
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      logo.mutate({ base64 });
    };
    reader.readAsDataURL(file);
  }
  return (
    <section className="settings-grid">
      <article className="section-panel settings-card">
        <div className="eyebrow">WORKSPACE PROFILE</div>
        <h2>Company settings</h2>
        <p>
          Maintain the business details printed on delivery challans and
          customer documents.
        </p>
        <form
          className="stack-form"
          onSubmit={event => {
            event.preventDefault();
            update.mutate(values);
          }}
        >
          <label>
            Business name
            <input
              required
              maxLength={180}
              disabled={!canEdit}
              value={values.name || settings?.name || ""}
              onChange={event =>
                setValues({ ...values, name: event.target.value })
              }
            />
          </label>
          <label>
            Registered email
            <input
              type="email"
              required
              disabled={!canEdit}
              value={values.email || settings?.email || ""}
              onChange={event =>
                setValues({ ...values, email: event.target.value })
              }
            />
          </label>
          <label>
            Business address
            <textarea
              rows={3}
              maxLength={4000}
              disabled={!canEdit}
              value={values.address}
              onChange={event =>
                setValues({ ...values, address: event.target.value })
              }
              placeholder="Street, city, state and postal code"
            />
          </label>
          <div className="form-grid">
            <label>
              Phone
              <input
                maxLength={48}
                disabled={!canEdit}
                value={values.phone}
                onChange={event =>
                  setValues({ ...values, phone: event.target.value })
                }
                placeholder="Business phone"
              />
            </label>
            <label>
              GST number
              <input
                maxLength={80}
                disabled={!canEdit}
                value={values.gstNumber}
                onChange={event =>
                  setValues({ ...values, gstNumber: event.target.value })
                }
                placeholder="GSTIN"
              />
            </label>
          </div>
          <label>
            Default currency
            <select
              disabled={!canEdit}
              value={values.currency || "INR"}
              onChange={event =>
                setValues({ ...values, currency: event.target.value })
              }
            >
              <option value="INR">INR — Indian Rupee</option>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — Pound Sterling</option>
              <option value="SGD">SGD — Singapore Dollar</option>
              <option value="AED">AED — UAE Dirham</option>
            </select>
          </label>
          {canEdit && (
            <button className="primary-btn" disabled={update.isPending}>
              {update.isPending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              Save company profile
            </button>
          )}
        </form>
        <div className="company-logo-upload">
          <div>
            {settings?.logoKey && (
              <img
                src={settings.logoUrl}
                alt="Saved company logo"
              />
            )}
            <span>
              <b>Company logo</b>
              <small>PNG or JPEG · up to 4 MB</small>
            </span>
          </div>
          {canEdit && (
            <label className="quiet-btn">
              {logo.isPending ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <FileCog size={14} />
              )}{" "}
              Upload logo
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={event => uploadLogo(event.target.files?.[0])}
              />
            </label>
          )}
        </div>
      </article>
      <article className="section-panel settings-card notifications-card">
        <div className="eyebrow">DELIVERY HISTORY</div>
        <h2>Email notifications</h2>
        <p>Invoice messages, reminders and automatic due-date checks.</p>
        <div className="delivery-config">
          <div className="delivery-icon">
            <Mail size={17} />
          </div>
          <div>
            <b>Transactional email</b>
            <span>
              {notices?.some(row => row.log.status === "sent")
                ? "Connected messages have been recorded."
                : "No successful sends yet. Configure the SMTP_* project secrets to deliver email."}
            </span>
          </div>
        </div>
        <div className="notice-list">
          {notices?.slice(0, 6).map(row => (
            <div className="notice-row" key={row.log.id}>
              <div>
                <b>{row.log.kind.replaceAll("_", " ")}</b>
                <span>
                  {row.log.recipient} · {fmtDate(row.log.createdAt)}
                </span>
              </div>
              <Status value={row.log.status} />
            </div>
          ))}
        </div>
        <div className="scheduled-banner">
          <Clock3 size={16} />
          <span>
            The daily due-invoice callback runs against a published build; the
            server timer is a development fallback.
          </span>
        </div>
      </article>
      <article className="section-panel settings-card danger-zone-card">
        <div className="eyebrow danger-eyebrow">DANGER ZONE</div>
        <h2>Reset all business data</h2>
        <p>
          Permanently clear this company’s business records. This action cannot
          be undone.
        </p>
        <div className="danger-scope">
          <b>Will be deleted</b>
          <span>
            Customers, invoices and quotations, line items, payments, expenses
            and custom expense heads, Bank Receipts transactions and opening
            balance/date, delivery challans, notification history and previous
            activity entries.
          </span>
          <b>Will be kept</b>
          <span>
            Your account, team roles and pending invitations; company profile,
            email and settings; and uploaded logo and letterhead. One audit
            entry will record this reset.
          </span>
          <b>Numbering will restart</b>
          <span>
            Invoice, quotation and delivery-challan sequences reset to 001 for
            each document year. The existing INV, QUO and DC prefixes remain.
          </span>
        </div>
        {canEdit ? (
          showResetConfirmation ? (
            <form
              className="reset-confirm-form"
              onSubmit={event => {
                event.preventDefault();
                if (resetPhrase === "RESET BUSINESS DATA")
                  resetBusinessData.mutate({
                    confirmation: "RESET BUSINESS DATA",
                  });
              }}
            >
              <label>
                Type <strong>RESET BUSINESS DATA</strong> to unlock the reset
                <input
                  autoComplete="off"
                  value={resetPhrase}
                  onChange={event => setResetPhrase(event.target.value)}
                  placeholder="RESET BUSINESS DATA"
                />
              </label>
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="quiet-btn"
                  onClick={() => {
                    setShowResetConfirmation(false);
                    setResetPhrase("");
                  }}
                  disabled={resetBusinessData.isPending}
                >
                  Cancel
                </button>
                <button
                  className="danger-primary-btn"
                  disabled={
                    resetPhrase !== "RESET BUSINESS DATA" ||
                    resetBusinessData.isPending
                  }
                >
                  {resetBusinessData.isPending
                    ? "Resetting…"
                    : "Permanently reset data"}
                </button>
              </div>
            </form>
          ) : (
            <button
              className="danger-outline-btn"
              onClick={() => setShowResetConfirmation(true)}
            >
              Reset all business data
            </button>
          )
        ) : (
          <div className="danger-admin-note">
            Only a workspace Admin can reset business data.
          </div>
        )}
      </article>
    </section>
  );
}

function DashboardView({
  data,
  loading,
  currency,
  periodLabel,
  onPage,
  onPayment,
  onCreate,
  onReminder,
}: {
  data: any;
  loading: boolean;
  currency: string;
  periodLabel: string;
  onPage: (p: PageKey) => void;
  onPayment: () => void;
  onCreate: () => void;
  onReminder: (id: number) => void;
}) {
  const metrics = data?.metrics;
  const cards = [
    {
      label: `Cash collected · ${periodLabel.toLowerCase()}`,
      value: metrics?.collected || 0,
      icon: Wallet,
      tone: "green",
      meta: `Payments received ${periodLabel.toLowerCase()}`,
    },
    {
      label: "Outstanding receivables",
      value: metrics?.pending || 0,
      icon: FileText,
      tone: "cyan",
      meta: `${metrics?.openInvoices || 0} open invoices`,
    },
    {
      label: "Overdue",
      value: metrics?.overdueCount || 0,
      icon: Activity,
      tone: "red",
      meta: "Invoices past their due date",
      count: true,
    },
    {
      label: "On hold",
      value: metrics?.onHold || 0,
      icon: Clock3,
      tone: "yellow",
      meta: "Invoice balance explicitly on hold",
    },
  ];
  return (
    <>
      <div className="metric-grid">
        {cards.map((m: any) => (
          <article className="metric-card" key={m.label}>
            <div className="metric-top">
              <span>{m.label}</span>
              <IconTile tone={m.tone}>
                <m.icon size={16} />
              </IconTile>
            </div>
            <strong className={`metric-value value-${m.tone}`}>
              {m.count ? m.value : money(m.value, currency)}
            </strong>
            <div className="metric-bottom">
              <span className="metric-detail">{m.meta}</span>
              <span className="metric-spark">↗</span>
            </div>
          </article>
        ))}
      </div>
      <section className="income-panel">
        <div className="panel-title-row">
          <div className="panel-title">
            <IconTile>
              <CircleDollarSign size={17} />
            </IconTile>
            <div>
              <h2>
                Net cash from operations{" "}
                <span>({periodLabel.toLowerCase()})</span>
              </h2>
              <p>
                Invoice payments received − invoice expenses − other expenses,
                on a cash basis.
              </p>
            </div>
          </div>
          <span className="margin-pill">
            <i /> CASH BASIS
          </span>
        </div>
        <div className="income-body">
          <div className="income-highlight">
            <span>NET CASH FROM OPERATIONS</span>
            <strong
              className={(metrics?.netCash ?? 0) < 0 ? "net-negative" : ""}
            >
              {money(metrics?.netCash || 0, currency)}
            </strong>
            <small>
              Payments collected less business costs paid during{" "}
              {periodLabel.toLowerCase()}
            </small>
            <div className="income-mini-row cash-breakdown">
              <div>
                <span>Invoice collections</span>
                <b>{money(metrics?.collected || 0, currency)}</b>
              </div>
              <div>
                <span>Invoice expenses</span>
                <b>{money(metrics?.invoiceExpenses || 0, currency)}</b>
              </div>
              <div>
                <span>Other expenses</span>
                <b>{money(metrics?.otherExpenses || 0, currency)}</b>
              </div>
            </div>
          </div>
          <div className="collection-side">
            <div className="collection-caption">
              INVOICE COHORTS · GROUPED BY MONTH RAISED
            </div>
            <div className="collection-head">
              <span>INVOICE MONTH</span>
              <span>RAISED</span>
              <span>COLLECTED TO DATE</span>
              <span>STILL DUE</span>
            </div>
            {data?.cohorts
              ?.slice()
              .reverse()
              .map((row: any) => (
                <div className="collection-row" key={row.key}>
                  <span>{row.month}</span>
                  <b>{money(row.billed, currency)}</b>
                  <b className="collected-value">
                    {money(row.collectedToDate, currency)}
                  </b>
                  <span>{money(row.outstanding, currency)}</span>
                </div>
              ))}
            {!loading && !data?.cohorts?.length && (
              <div className="collection-empty">
                <FileText size={19} />
                <span>Invoice cohorts will appear as invoices are raised.</span>
                <button onClick={onCreate}>
                  Create an invoice <ArrowRight size={13} />
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="dashboard-lower">
        <article className="section-panel trend-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">CASH FLOW</div>
              <h2>Collections trend</h2>
            </div>
            <button
              className="quiet-btn small-btn"
              onClick={() => onPage("Reports")}
            >
              Full report <ArrowRight size={14} />
            </button>
          </div>
          <div className="chart-wrap">
            {data?.trend?.some(
              (point: any) =>
                point.amount > 0 ||
                point.invoiceExpenses > 0 ||
                point.otherExpenses > 0
            ) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.trend}
                  margin={{ top: 10, right: 6, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="cash-gradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#26dfc7"
                        stopOpacity={0.25}
                      />
                      <stop offset="100%" stopColor="#26dfc7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#ffffff0b" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#75808d", fontSize: 11 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#75808d", fontSize: 10 }}
                  />
                  <ChartTooltip
                    contentStyle={{
                      background: "#12171c",
                      border: "1px solid #29323a",
                      borderRadius: 12,
                      color: "#e8edf1",
                    }}
                    formatter={(value: any) => money(value, currency)}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    name="Cash collected"
                    stroke="#26dfc7"
                    strokeWidth={2.4}
                    fill="url(#cash-gradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">
                <div className="chart-ghost">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <p>Collections will chart here as payments arrive.</p>
                <button className="text-btn" onClick={onPayment}>
                  Record a payment
                </button>
              </div>
            )}
          </div>
        </article>
        <article className="section-panel top-customers">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">RELATIONSHIPS</div>
              <h2>Top customers</h2>
            </div>
            <button className="icon-btn" onClick={() => onPage("Customers")}>
              <ArrowRight size={16} />
            </button>
          </div>
          {data?.topCustomers?.map((c: any, i: number) => (
            <div className="top-customer-row" key={c.id}>
              <span className="rank">0{i + 1}</span>
              <div className="customer-mini-avatar">{c.name[0]}</div>
              <div className="top-customer-name">
                <b>{c.name}</b>
                <span>{money(c.received, currency)} collected</span>
              </div>
              <div className="customer-bar">
                <i style={{ width: `${Math.max(12, 100 - i * 18)}%` }} />
              </div>
            </div>
          ))}
          {!data?.topCustomers?.length && !loading && (
            <div className="mini-empty">No customer collections yet.</div>
          )}
        </article>
      </section>
      <section className="quick-stats">
        {[
          { label: "DSO · days", value: "—", icon: Gauge },
          { label: "Avg. days to get paid", value: "—", icon: Clock3 },
          {
            label: "Collection rate",
            value: metrics?.totalInvoiced
              ? `${Math.round((metrics?.totalCollected / metrics?.totalInvoiced) * 100)}%`
              : "—",
            icon: TrendingUp,
          },
          {
            label: "Overdue balance",
            value: money(
              (data?.aging?.["0-30"] || 0) +
                (data?.aging?.["30-60"] || 0) +
                (data?.aging?.["60+"] || 0),
              currency
            ),
            icon: BadgeIndianRupee,
          },
        ].map((item: any) => (
          <div className="quick-stat" key={item.label}>
            <item.icon size={16} />
            <span>{item.label}</span>
            <b>{item.value}</b>
          </div>
        ))}
      </section>
      {data?.recent?.length > 0 && (
        <section className="section-panel recent-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">RECENT ACTIVITY</div>
              <h2>Latest documents</h2>
            </div>
            <button
              className="quiet-btn small-btn"
              onClick={() => onPage("Invoices")}
            >
              All invoices <ArrowRight size={14} />
            </button>
          </div>
          <DocumentTable
            rows={data.recent}
            compact
            currency={currency}
            onSend={() => {}}
            onReminder={onReminder}
            onPay={onPayment}
            onPrint={() => {}}
            onStatus={() => {}}
            onDelete={() => {}}
          />
        </section>
      )}
    </>
  );
}

function DocumentTable({
  rows,
  loading,
  currency,
  onSend,
  onReminder,
  onPay,
  onPrint,
  onStatus,
  onDelete,
  quotation = false,
  onConvert,
  compact = false,
}: {
  rows: any[];
  loading?: boolean;
  currency: string;
  onSend: (id: number) => void;
  onReminder: (id: number) => void;
  onPay: () => void;
  onPrint: (id: number) => void;
  onStatus: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  quotation?: boolean;
  onConvert?: (id: number) => void;
  compact?: boolean;
}) {
  return (
    <div className="data-table-wrap">
      <table>
        <thead>
          <tr>
            <th>DOCUMENT</th>
            <th>CUSTOMER</th>
            <th>ISSUED</th>
            <th>DUE DATE</th>
            <th>STATUS</th>
            <th className="right">TOTAL</th>
            <th className="right">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => {
            const d = r.document ?? r;
            const c = r.customer;
            return (
              <tr key={d.id}>
                <td>
                  <div className="document-id">
                    <div className="doc-icon">
                      <FileText size={16} />
                    </div>
                    <span>
                      <b className="mono bright">{d.number}</b>
                      <small>
                        {d.kind === "quotation" ? "Quote" : "Invoice"}
                      </small>
                    </span>
                  </div>
                </td>
                <td>{c?.name ?? "—"}</td>
                <td>{fmtDate(d.issueDate)}</td>
                <td>{fmtDate(d.dueDate)}</td>
                <td>
                  <Status value={d.status} />
                </td>
                <td className="right amount-col">
                  <b>{money(d.total, currency)}</b>
                  {Number(d.amountPaid) > 0 &&
                    Number(d.amountPaid) < Number(d.total) && (
                      <small>
                        {money(
                          Number(d.total) - Number(d.amountPaid),
                          currency
                        )}{" "}
                        due
                      </small>
                    )}
                </td>
                <td className="right">
                  <div className="row-actions">
                    <button
                      className="small-action"
                      onClick={() => onPrint(d.id)}
                      title="Preview and export PDF"
                    >
                      <Eye size={14} />
                      <span>{quotation ? "Preview" : "PDF"}</span>
                    </button>
                    {quotation ? (
                      onConvert && (
                        <button
                          className="small-action"
                          onClick={() => onConvert(d.id)}
                          title="Convert to invoice"
                        >
                          <ArrowRight size={14} />
                          <span>Convert</span>
                        </button>
                      )
                    ) : (
                      <>
                        <button
                          className="small-action"
                          onClick={() => onSend(d.id)}
                          title="Email document"
                        >
                          <Send size={14} />
                        </button>
                        {!compact && (
                          <button
                            className="small-action"
                            onClick={() => onReminder(d.id)}
                            title="Send reminder"
                          >
                            <Bell size={14} />
                          </button>
                        )}
                        {!compact && (
                          <button
                            className="small-action"
                            onClick={onPay}
                            title="Record payment"
                          >
                            <Wallet size={14} />
                          </button>
                        )}
                        {!compact && (
                          <select
                            className="row-status-select"
                            aria-label="Change status"
                            value={d.status === "overdue" ? "sent" : d.status}
                            onChange={e => onStatus(d.id, e.target.value)}
                          >
                            <option value="draft">Draft</option>
                            <option value="sent">Sent</option>
                            <option value="on_hold">On hold</option>
                          </select>
                        )}
                        {!compact && (
                          <button
                            className="small-action danger-icon"
                            onClick={() => onDelete(d.id)}
                            title="Delete unpaid record"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading && (
        <div className="table-loading">
          <LoaderCircle className="spin" size={19} /> Loading records…
        </div>
      )}
    </div>
  );
}

function ReportsView({
  data,
  loading,
  currency,
  periodLabel,
}: {
  data: any;
  loading: boolean;
  currency: string;
  periodLabel: string;
}) {
  return (
    <div className="reports-page">
      <div className="report-header">
        <div>
          <div className="eyebrow">PERFORMANCE & AGING</div>
          <h2>Cash performance, receivables, and what’s next.</h2>
          <p>
            Net cash is invoice payments received during{" "}
            {periodLabel.toLowerCase()} less invoice and other expenses paid in
            the same period.
          </p>
        </div>
        <div className="report-period">
          <CalendarDays size={16} /> Cash basis · {periodLabel}
        </div>
      </div>
      <div className="report-metrics">
        <div>
          <span>Net cash from operations</span>
          <b>{money(data?.metrics?.netCash, currency)}</b>
          <small>Cash receipts less expenses paid</small>
        </div>
        <div>
          <span>Invoice collections</span>
          <b>{money(data?.metrics?.collected, currency)}</b>
          <small>Payments received {periodLabel.toLowerCase()}</small>
        </div>
        <div>
          <span>Invoice expenses</span>
          <b>{money(data?.metrics?.invoiceExpenses, currency)}</b>
          <small>Direct costs {periodLabel.toLowerCase()}</small>
        </div>
        <div>
          <span>Other operating expenses</span>
          <b>{money(data?.metrics?.otherExpenses, currency)}</b>
          <small>Overheads {periodLabel.toLowerCase()}</small>
        </div>
      </div>
      <div className="reports-content">
        <article className="section-panel report-chart">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">COLLECTIONS & COSTS</div>
              <h2>Cash trend · {periodLabel}</h2>
            </div>
            <span className="margin-pill">
              <i /> PAYMENT & EXPENSE LEDGER
            </span>
          </div>
          <div className="chart-wrap tall-chart">
            {data?.trend?.some(
              (point: any) =>
                point.amount > 0 ||
                point.invoiceExpenses > 0 ||
                point.otherExpenses > 0
            ) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.trend}
                  margin={{ top: 12, right: 14, left: -13, bottom: 3 }}
                >
                  <defs>
                    <linearGradient
                      id="report-gradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#248bff"
                        stopOpacity={0.23}
                      />
                      <stop offset="100%" stopColor="#248bff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#ffffff0d" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#7e8994", fontSize: 11 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#7e8994", fontSize: 10 }}
                  />
                  <ChartTooltip
                    contentStyle={{
                      background: "#12171c",
                      border: "1px solid #29323a",
                      borderRadius: 12,
                      color: "#e8edf1",
                    }}
                    formatter={(value: any) => money(value, currency)}
                  />
                  <Area
                    type="monotone"
                    dataKey="collections"
                    name="Collections"
                    stroke="#27dfc7"
                    strokeWidth={2.5}
                    fill="url(#report-gradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="invoiceExpenses"
                    name="Invoice expenses"
                    stroke="#4aa7ff"
                    strokeWidth={2}
                    fill="transparent"
                  />
                  <Area
                    type="monotone"
                    dataKey="otherExpenses"
                    name="Other expenses"
                    stroke="#f2c94c"
                    strokeWidth={2}
                    fill="transparent"
                  />
                  <Area
                    type="monotone"
                    dataKey="netCash"
                    name="Net cash"
                    stroke="#54d98e"
                    strokeWidth={2.5}
                    fill="transparent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                icon={ChartNoAxesCombined}
                title="Not enough data yet"
                copy="Cash and expense trends appear as payments and expenses are recorded."
              />
            )}
          </div>
        </article>
        <article className="section-panel aging-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">ACCOUNTS RECEIVABLE</div>
              <h2>Overdue aging</h2>
            </div>
            <Clock3 size={17} />
          </div>
          {["0-30", "30-60", "60+"].map((range, i) => (
            <div className="aging-row" key={range}>
              <div>
                <b>{range} days</b>
                <span>
                  {i === 0 ? "Recent" : i === 1 ? "Needs attention" : "At risk"}
                </span>
              </div>
              <strong>{money(data?.aging?.[range] ?? 0, currency)}</strong>
            </div>
          ))}
          <div className="aging-foot">
            Only unpaid invoice balances are included.
          </div>
        </article>
      </div>
      <article className="section-panel report-cohorts">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">INVOICE ISSUE-MONTH COHORT</div>
            <h2>Raised, collected to date, and still due</h2>
          </div>
        </div>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>INVOICE MONTH</th>
                <th className="right">INVOICED</th>
                <th className="right">COLLECTED TO DATE</th>
                <th className="right">STILL DUE</th>
              </tr>
            </thead>
            <tbody>
              {data?.cohorts
                ?.slice()
                .reverse()
                .map((row: any) => (
                  <tr key={row.key}>
                    <td>{row.month}</td>
                    <td className="right">{money(row.billed, currency)}</td>
                    <td className="right collected-value">
                      {money(row.collectedToDate, currency)}
                    </td>
                    <td className="right">
                      {money(row.outstanding, currency)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!loading &&
            (!data?.cohorts?.length ||
              data.cohorts.every((row: any) => !row.billed)) && (
              <div className="expense-table-empty">
                No issued invoice cohorts in this view.
              </div>
            )}
        </div>
      </article>
    </div>
  );
}
