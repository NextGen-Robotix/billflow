import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Download,
  Eye,
  FilePlus2,
  LoaderCircle,
  List,
  MapPin,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { DocumentPreview } from "./DocumentPreview";
import { WorkspaceModal } from "./WorkspaceModal";

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
const amountFor = (item: ItemDraft) =>
  Math.round((Number(item.quantity) || 0) * (Number(item.rate) || 0) * 100) /
  100;
type ItemDraft = {
  name: string;
  hsn: string;
  quantity: string;
  unit: string;
  rate: string;
};
type ChallanDraft = {
  id?: number;
  customerId: string;
  challanDate: string;
  status: "draft" | "sent";
  consigneeName: string;
  consigneeAddress: string;
  placeOfDelivery: string;
  consigneePhone: string;
  consigneeGst: string;
  dispatchMode: "hand" | "transport";
  transporter: string;
  vehicleNo: string;
  ewayBillNo: string;
  notes: string;
  items: ItemDraft[];
};
const newItem = (): ItemDraft => ({
  name: "",
  hsn: "",
  quantity: "1",
  unit: "pcs",
  rate: "0",
});
const blankDraft = (): ChallanDraft => ({
  customerId: "",
  challanDate: today(),
  status: "draft",
  consigneeName: "",
  consigneeAddress: "",
  placeOfDelivery: "",
  consigneePhone: "",
  consigneeGst: "",
  dispatchMode: "transport",
  transporter: "",
  vehicleNo: "",
  ewayBillNo: "",
  notes: "",
  items: [newItem()],
});

export function ChallansPanel({
  customers,
  company,
  canEdit,
  canEditFormat,
  onOpenFormat,
  dateFrom,
  dateTo,
  periodLabel,
}: {
  customers: any[];
  company: any;
  canEdit: boolean;
  canEditFormat: boolean;
  onOpenFormat: () => void;
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ChallanDraft | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [showFormat, setShowFormat] = useState(false);
  const rows = trpc.challans.list.useQuery({
    search: search || undefined,
    dateFrom,
    dateTo,
  });
  const format = trpc.documentFormat.get.useQuery(undefined, {
    enabled: showFormat,
  });
  const editing = trpc.challans.detail.useQuery(
    { id: editId ?? 0 },
    { enabled: !!editId }
  );
  const preview = trpc.challans.detail.useQuery(
    { id: previewId ?? 0 },
    { enabled: !!previewId }
  );
  const save = trpc.challans.save.useMutation({
    onSuccess: async result => {
      toast.success(`Delivery challan ${result.number} saved`);
      setDraft(null);
      setEditId(null);
      await Promise.all([
        utils.challans.list.invalidate(),
        utils.dashboard.overview.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.challans.remove.useMutation({
    onSuccess: async () => {
      toast.success("Delivery challan deleted");
      await utils.challans.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!editId || editing.data?.challan.id !== editId) return;
    const challan = editing.data.challan;
    setDraft({
      id: challan.id,
      customerId: challan.customerId ? String(challan.customerId) : "",
      challanDate: challan.challanDate,
      status: challan.status,
      consigneeName: challan.consigneeName || editing.data.customer?.name || "",
      consigneeAddress:
        challan.consigneeAddress ?? editing.data.customer?.address ?? "",
      placeOfDelivery: challan.placeOfDelivery ?? "",
      consigneePhone:
        challan.consigneePhone ?? editing.data.customer?.phone ?? "",
      consigneeGst: challan.consigneeGst ?? editing.data.customer?.taxId ?? "",
      dispatchMode: challan.dispatchMode ?? "hand",
      transporter: challan.transporter ?? "",
      vehicleNo: challan.vehicleNo ?? "",
      ewayBillNo: challan.ewayBillNo ?? "",
      notes: challan.notes ?? "",
      items: editing.data.items.map(item => {
        const quantity = Number(item.quantity) || 1;
        const savedRate = Number(item.rate) || 0;
        const legacyRate = Number(item.total) / quantity;
        return {
          name: item.name,
          hsn: item.hsn ?? "",
          quantity: String(item.quantity),
          unit: item.unit || "pcs",
          rate: String(savedRate > 0 ? savedRate : legacyRate || 0),
        };
      }),
    });
  }, [editId, editing.data]);

  const computedTotal = useMemo(
    () =>
      Math.round(
        (draft?.items.reduce((sum, item) => sum + amountFor(item), 0) ?? 0) *
          100
      ) / 100,
    [draft]
  );
  const totalQuantity = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of draft?.items ?? []) {
      const unit = item.unit.trim() || "pcs";
      totals.set(unit, (totals.get(unit) ?? 0) + (Number(item.quantity) || 0));
    }
    return (
      [...totals.entries()]
        .map(
          ([unit, quantity]) => `${Math.round(quantity * 1000) / 1000} ${unit}`
        )
        .join(" · ") || "0"
    );
  }, [draft]);
  const setItem = (index: number, key: keyof ItemDraft, value: string) =>
    setDraft(current =>
      current
        ? {
            ...current,
            items: current.items.map((item, itemIndex) =>
              itemIndex === index ? { ...item, [key]: value } : item
            ),
          }
        : current
    );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    save.mutate({
      id: draft.id,
      customerId: draft.customerId ? Number(draft.customerId) : null,
      challanDate: draft.challanDate,
      status: draft.status,
      consigneeName: draft.consigneeName,
      consigneeAddress: draft.consigneeAddress || undefined,
      placeOfDelivery: draft.placeOfDelivery || undefined,
      consigneePhone: draft.consigneePhone || undefined,
      consigneeGst: draft.consigneeGst || undefined,
      dispatchMode: draft.dispatchMode,
      transporter: draft.transporter || undefined,
      vehicleNo: draft.vehicleNo || undefined,
      ewayBillNo: draft.ewayBillNo || undefined,
      notes: draft.notes || undefined,
      items: draft.items.map(item => ({
        name: item.name,
        hsn: item.hsn || undefined,
        quantity: Number(item.quantity),
        unit: item.unit || "pcs",
        rate: Number(item.rate),
      })),
    });
  }

  function openEdit(id: number) {
    if (!canEdit) return;
    setDraft(null);
    setEditId(id);
  }

  function closeEditor() {
    setDraft(null);
    setEditId(null);
  }

  const previewRecord = preview.data
    ? {
        document: {
          ...preview.data.challan,
          kind: "delivery_challan",
          issueDate: preview.data.challan.challanDate,
        },
        customer: {
          name:
            preview.data.challan.consigneeName || preview.data.customer?.name,
          address:
            preview.data.challan.consigneeAddress ||
            preview.data.customer?.address,
          phone:
            preview.data.challan.consigneePhone ?? preview.data.customer?.phone,
          taxId:
            preview.data.challan.consigneeGst ?? preview.data.customer?.taxId,
          email: preview.data.customer?.email,
        },
        items: preview.data.items,
        company,
      }
    : null;

  return (
    <section className="section-panel challans-panel challans-workspace">
      <div className="challan-page-header">
        <div>
          <div className="eyebrow">DISPATCH</div>
          <h2>Delivery challans</h2>
          <p>
            Create, store and print challans for every dispatch. Numbers are
            unique (DC-YYYY-###).
          </p>
          <span className="challan-period-caption">Showing {periodLabel}</span>
        </div>
        <div className="challan-header-actions">
          <button
            className={!draft ? "quiet-btn challan-header-active" : "quiet-btn"}
            onClick={closeEditor}
          >
            <List size={14} /> All challans
            <span className="count-chip">{rows.data?.length ?? 0}</span>
          </button>
          {canEdit && (
            <button
              className="primary-btn"
              onClick={() => {
                setEditId(null);
                setDraft(blankDraft());
              }}
            >
              <Plus size={15} /> Create challan
            </button>
          )}
          <button className="quiet-btn" onClick={() => setShowFormat(true)}>
            <SlidersHorizontal size={14} /> Challan format
          </button>
        </div>
      </div>

      {draft ? (
        <form className="challan-inline-form" onSubmit={submit}>
          <section className="challan-section-card challan-meta-card">
            <div className="challan-meta-grid">
              <label>
                Challan date
                <input
                  type="date"
                  required
                  value={draft.challanDate}
                  onChange={event =>
                    setDraft({ ...draft, challanDate: event.target.value })
                  }
                />
              </label>
              <label>
                Status
                <select
                  value={draft.status}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      status: event.target.value as ChallanDraft["status"],
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                </select>
              </label>
              <label>
                Pick saved customer (optional)
                <select
                  value={draft.customerId}
                  onChange={event => {
                    const selected = customers.find(
                      customer => String(customer.id) === event.target.value
                    );
                    setDraft({
                      ...draft,
                      customerId: event.target.value,
                      consigneeName: selected?.name ?? "",
                      consigneeAddress: selected?.address ?? "",
                      consigneePhone: selected?.phone ?? "",
                      consigneeGst: selected?.taxId ?? "",
                    });
                  }}
                >
                  <option value="">— type details manually —</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="challan-section-card">
            <div className="challan-card-title">
              <Building2 size={16} />
              <span>Delivery challan for</span>
              <span className="challan-ref-placeholder">
                {draft.id
                  ? `Ref no. ${editing.data?.challan.number ?? ""}`
                  : "Ref no. assigned on save"}
              </span>
            </div>
            <div className="challan-consignee-grid">
              <label>
                Client / consignee name <em>*</em>
                <input
                  required
                  maxLength={180}
                  placeholder="Business or person receiving the goods"
                  value={draft.consigneeName}
                  onChange={event =>
                    setDraft({ ...draft, consigneeName: event.target.value })
                  }
                />
              </label>
              <label>
                Place of delivery
                <input
                  maxLength={240}
                  placeholder="Site / warehouse / city"
                  value={draft.placeOfDelivery}
                  onChange={event =>
                    setDraft({ ...draft, placeOfDelivery: event.target.value })
                  }
                />
              </label>
              <label className="challan-address-field">
                Address
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={draft.consigneeAddress}
                  onChange={event =>
                    setDraft({ ...draft, consigneeAddress: event.target.value })
                  }
                />
              </label>
              <label>
                Phone (optional)
                <input
                  type="tel"
                  maxLength={40}
                  value={draft.consigneePhone}
                  onChange={event =>
                    setDraft({ ...draft, consigneePhone: event.target.value })
                  }
                />
              </label>
              <label>
                GSTIN (optional)
                <input
                  maxLength={80}
                  value={draft.consigneeGst}
                  onChange={event =>
                    setDraft({ ...draft, consigneeGst: event.target.value })
                  }
                />
              </label>
            </div>
          </section>

          <section className="challan-section-card challan-items-card">
            <div className="challan-card-heading">
              <div className="challan-card-title">
                <List size={16} /> <span>Items</span>
              </div>
              <button
                type="button"
                className="quiet-btn"
                onClick={() =>
                  setDraft({ ...draft, items: [...draft.items, newItem()] })
                }
              >
                <Plus size={14} /> Add item
              </button>
            </div>
            <div className="challan-item-scroll">
              <table className="challan-editor-table">
                <thead>
                  <tr>
                    <th className="challan-number-col">#</th>
                    <th>Item description</th>
                    <th>HSN</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th className="right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.items.map((item, index) => (
                    <tr key={index}>
                      <td className="challan-row-index">{index + 1}</td>
                      <td>
                        <input
                          required
                          maxLength={240}
                          aria-label={`Item ${index + 1} description`}
                          placeholder="Describe the goods"
                          value={item.name}
                          onChange={event =>
                            setItem(index, "name", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          maxLength={40}
                          aria-label={`Item ${index + 1} HSN`}
                          value={item.hsn}
                          onChange={event =>
                            setItem(index, "hsn", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          required
                          type="number"
                          min="0.001"
                          step="0.001"
                          aria-label={`Item ${index + 1} quantity`}
                          value={item.quantity}
                          onChange={event =>
                            setItem(index, "quantity", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          required
                          maxLength={32}
                          aria-label={`Item ${index + 1} unit`}
                          value={item.unit}
                          onChange={event =>
                            setItem(index, "unit", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`Item ${index + 1} rate`}
                          value={item.rate}
                          onChange={event =>
                            setItem(index, "rate", event.target.value)
                          }
                        />
                      </td>
                      <td className="right challan-item-amount">
                        {money(amountFor(item), company.currency)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="small-action danger-icon"
                          aria-label={`Remove item ${index + 1}`}
                          disabled={draft.items.length <= 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              items: draft.items.filter(
                                (_, itemIndex) => itemIndex !== index
                              ),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total quantities</td>
                    <td colSpan={3} className="challan-total-quantity">
                      {totalQuantity}
                    </td>
                    <td className="right challan-grand-total">
                      {money(computedTotal, company.currency)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="challan-section-card challan-dispatch-card">
            <div className="challan-card-heading">
              <div className="challan-card-title">
                <Truck size={16} /> <span>Dispatch</span>
              </div>
              <div
                className="challan-mode-switch"
                role="group"
                aria-label="Delivery method"
              >
                <button
                  type="button"
                  className={draft.dispatchMode === "hand" ? "selected" : ""}
                  onClick={() => setDraft({ ...draft, dispatchMode: "hand" })}
                >
                  Hand delivery
                </button>
                <button
                  type="button"
                  className={
                    draft.dispatchMode === "transport" ? "selected" : ""
                  }
                  onClick={() =>
                    setDraft({ ...draft, dispatchMode: "transport" })
                  }
                >
                  Via transport
                </button>
              </div>
            </div>
            {draft.dispatchMode === "transport" ? (
              <div className="challan-dispatch-grid">
                <label>
                  Dispatched via (transporter)
                  <input
                    maxLength={180}
                    value={draft.transporter}
                    onChange={event =>
                      setDraft({ ...draft, transporter: event.target.value })
                    }
                  />
                </label>
                <label>
                  Vehicle no
                  <input
                    maxLength={60}
                    value={draft.vehicleNo}
                    onChange={event =>
                      setDraft({ ...draft, vehicleNo: event.target.value })
                    }
                  />
                </label>
                <label>
                  E-way bill no
                  <input
                    maxLength={60}
                    value={draft.ewayBillNo}
                    onChange={event =>
                      setDraft({ ...draft, ewayBillNo: event.target.value })
                    }
                  />
                </label>
              </div>
            ) : (
              <div className="challan-hand-delivery">
                <MapPin size={14} /> Hand delivery to the place of delivery
                above.
              </div>
            )}
            <label className="challan-remarks-field">
              Remarks
              <textarea
                rows={2}
                maxLength={4000}
                value={draft.notes}
                onChange={event =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </label>
          </section>

          <div className="challan-form-footer">
            <div className="challan-company-summary">
              <b>{company.name}</b>
              <span>
                {company.address || "Add your company address in Settings"}
              </span>
              <small>
                {[
                  company.phone,
                  company.gstNumber ? `GSTIN ${company.gstNumber}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
            <div className="challan-form-actions">
              <button type="button" className="quiet-btn" onClick={closeEditor}>
                <ArrowLeft size={14} /> Cancel
              </button>
              <button className="primary-btn" disabled={save.isPending}>
                {save.isPending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Download size={15} />
                )}
                {draft.id ? "Save changes" : "Create challan"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <div className="table-filters">
            <div className="search-box">
              <Search size={15} />
              <input
                placeholder="Search challan number or customer"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CHALLAN NO.</th>
                  <th>DELIVER TO</th>
                  <th>DATE</th>
                  <th>STATUS</th>
                  <th className="right">TOTAL AMOUNT</th>
                  <th className="right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {rows.data?.map(row => (
                  <tr key={row.challan.id}>
                    <td className="mono bright">{row.challan.number}</td>
                    <td>
                      {row.challan.consigneeName || row.customer?.name || "—"}
                    </td>
                    <td>{row.challan.challanDate}</td>
                    <td>
                      <span
                        className={`challan-status challan-status-${row.challan.status}`}
                      >
                        {row.challan.status === "draft" ? "Draft" : "Sent"}
                      </span>
                    </td>
                    <td className="right amount-col">
                      {money(row.challan.total, company.currency)}
                    </td>
                    <td className="right">
                      <div className="row-actions">
                        <button
                          className="small-action"
                          title="Preview challan"
                          onClick={() => setPreviewId(row.challan.id)}
                        >
                          <Eye size={14} />
                        </button>
                        {canEdit && (
                          <>
                            <button
                              className="small-action"
                              title="Edit challan"
                              onClick={() => openEdit(row.challan.id)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="small-action danger-icon"
                              title="Delete challan"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete challan ${row.challan.number}?`
                                  )
                                )
                                  remove.mutate({ id: row.challan.id });
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.isLoading && (
              <div className="table-loading">
                <LoaderCircle className="spin" size={18} /> Loading challans…
              </div>
            )}
            {!rows.isLoading && !rows.data?.length && (
              <div className="expense-table-empty">
                <FilePlus2 size={21} />
                <span>
                  No delivery challans yet. Add the details for your first
                  dispatch.
                </span>
                {canEdit && (
                  <button
                    className="text-btn"
                    onClick={() => setDraft(blankDraft())}
                  >
                    Create the first challan
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {editId && !draft && (
        <div className="challan-edit-loading">
          <LoaderCircle className="spin" size={18} /> Loading challan details…
        </div>
      )}
      {previewRecord && (
        <DocumentPreview
          record={previewRecord}
          onClose={() => setPreviewId(null)}
        />
      )}
      {showFormat && (
        <WorkspaceModal
          title="Challan format"
          subtitle="Preview the branded challan layout used for dispatch documents."
          onClose={() => setShowFormat(false)}
          wide
        >
          <div className="challan-format-preview">
            <div className="challan-format-paper">
              <div className="challan-format-business">
                <div>
                  {format.data?.company.logoUrl && (
                    <img src={format.data.company.logoUrl} alt="Company logo" />
                  )}
                  <span>
                    <b>{format.data?.company.name ?? company.name}</b>
                    <small>
                      {format.data?.company.address ?? company.address}
                    </small>
                    <small>
                      {[
                        format.data?.company.phone ?? company.phone,
                        format.data?.company.gstNumber ?? company.gstNumber,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                </div>
                <div className="challan-format-number">
                  <small>CHALLAN NO.</small>
                  <b>DC-YYYY-001</b>
                  <small>Challan date</small>
                </div>
              </div>
              <h3>DELIVERY CHALLAN FOR</h3>
              <div className="challan-format-fields">
                <span>Client / consignee name</span>
                <span>Place of delivery</span>
                <span>Address</span>
                <span>Phone (optional) · GSTIN (optional)</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Item description</th>
                    <th>HSN</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Goods supplied</td>
                    <td>—</td>
                    <td>1</td>
                    <td>pcs</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
              <div className="challan-format-dispatch">
                <b>Dispatch · Hand delivery / Via transport</b>
                <span>Transporter · Vehicle no · E-way bill no · Remarks</span>
              </div>
            </div>
            <div className="challan-format-controls">
              <span>
                {format.data?.format.letterheadKey
                  ? "Your saved PDF letterhead and reserved upper/lower bands apply to this format."
                  : "This format will use your company details. You can add a PDF letterhead and reserved bands."}
              </span>
              {canEditFormat && (
                <button
                  className="quiet-btn"
                  onClick={() => {
                    setShowFormat(false);
                    onOpenFormat();
                  }}
                >
                  <SlidersHorizontal size={14} /> Edit letterhead & safe zones
                </button>
              )}
            </div>
          </div>
        </WorkspaceModal>
      )}
    </section>
  );
}
