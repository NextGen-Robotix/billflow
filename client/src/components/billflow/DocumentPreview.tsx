import { useState } from "react";
import { Download, LoaderCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { buildBillFlowPdf, type BillFlowOutput } from "@/lib/documentPdf";
import { WorkspaceModal } from "./WorkspaceModal";

const money = (amount: unknown, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0));
const dateLabel = (value?: string | null) =>
  value
    ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const quantitySummary = (items: any[]) => {
  const units = new Map<string, number>();
  for (const item of items ?? []) {
    const unit = String(item.unit || "pcs").trim() || "pcs";
    units.set(unit, (units.get(unit) ?? 0) + (Number(item.quantity) || 0));
  }
  return (
    [...units.entries()]
      .map(
        ([unit, quantity]) => `${Math.round(quantity * 1000) / 1000} ${unit}`
      )
      .join(" · ") || "0"
  );
};

type Props = { record: any; onClose: () => void };

export function DocumentPreview({ record, onClose }: Props) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState<"download" | "print" | null>(null);
  const data = trpc.documentFormat.get.useQuery(undefined, { retry: false });
  const doc = record.document;
  const isChallan = doc.kind === "delivery_challan";
  const title = isChallan
    ? "Delivery challan"
    : doc.kind === "quotation"
      ? "Quotation preview"
      : "Invoice preview";

  async function makePdf(openForPrint: boolean) {
    try {
      setBusy(openForPrint ? "print" : "download");
      const format = data.data ?? (await utils.documentFormat.get.fetch());
      const [letterhead, logo] = await Promise.all([
        format.format.letterheadKey
          ? utils.documentFormat.letterheadBytes.fetch()
          : Promise.resolve({ base64: null }),
        format.company.logoKey
          ? utils.documentFormat.logoBytes.fetch()
          : Promise.resolve({ base64: null }),
      ]);
      const out: BillFlowOutput = {
        kind: doc.kind,
        number: doc.number,
        date: doc.issueDate ?? doc.challanDate,
        dueDate: doc.dueDate,
        status: doc.status,
        subtotal: Number(doc.subtotal ?? 0),
        taxTotal: Number(doc.taxTotal ?? 0),
        discount: Number(doc.discount ?? 0),
        total: Number(doc.total ?? 0),
        amountPaid: Number(doc.amountPaid ?? 0),
        notes: doc.notes,
        placeOfDelivery: doc.placeOfDelivery,
        dispatchMode: doc.dispatchMode,
        transporter: doc.transporter,
        vehicleNo: doc.vehicleNo,
        ewayBillNo: doc.ewayBillNo,
        customer: record.customer,
        company: format.company,
        items: (record.items ?? []).map((item: any) => ({
          ...item,
          quantity: Number(item.quantity),
          rate: Number(item.rate ?? 0),
          taxPercent: Number(item.taxPercent ?? 0),
          total: Number(item.total ?? 0),
        })),
        reservedTopMm: format.format.reservedTopMm,
        reservedBottomMm: format.format.reservedBottomMm,
        letterheadBase64: letterhead.base64,
        logoBase64: logo.base64,
      };
      const pdf = await buildBillFlowPdf(out);
      const blob = new Blob([pdf.slice().buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      if (openForPrint) {
        const tab = window.open("about:blank", "_blank");
        if (!tab) {
          toast.error("Allow pop-ups to open this PDF for printing.");
          URL.revokeObjectURL(url);
          return;
        }
        tab.opener = null;
        tab.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${doc.number}.pdf`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the PDF."
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <WorkspaceModal
      title={title}
      subtitle={`${doc.number} · ${dateLabel(doc.issueDate ?? doc.challanDate)}`}
      onClose={onClose}
      wide
    >
      <div className="document-preview-content">
        <div className="document-preview-paper">
          <div className="document-preview-brand">
            {data.data?.company.logoUrl && (
              <img src={data.data.company.logoUrl} alt="Company logo" />
            )}
            <div>
              <b>
                {data.data?.company.name ?? record.company?.name ?? "Business"}
              </b>
              {(data.data?.company.address ?? record.company?.address) && (
                <span>
                  {data.data?.company.address ?? record.company?.address}
                </span>
              )}
              {(data.data?.company.phone || data.data?.company.email) && (
                <span>
                  {[data.data?.company.phone, data.data?.company.email]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
              {data.data?.company.gstNumber && (
                <span>GSTIN: {data.data.company.gstNumber}</span>
              )}
            </div>
            <div className="document-preview-number">
              <small>
                {isChallan ? "CHALLAN NO." : doc.kind.toUpperCase()}
              </small>
              <b>{doc.number}</b>
            </div>
          </div>
          <div className="document-preview-meta">
            <div>
              <small>{isChallan ? "DELIVER TO" : "BILL TO"}</small>
              <b>{record.customer?.name ?? "—"}</b>
              <span>{record.customer?.address ?? ""}</span>
              <span>{record.customer?.phone ?? ""}</span>
              <span>{record.customer?.email ?? ""}</span>
              <span>
                {record.customer?.taxId
                  ? `GSTIN: ${record.customer.taxId}`
                  : ""}
              </span>
            </div>
            <div>
              <small>{isChallan ? "CHALLAN DATE" : "ISSUE DATE"}</small>
              <b>{dateLabel(doc.issueDate ?? doc.challanDate)}</b>
              {!isChallan && (
                <>
                  <small>DUE DATE</small>
                  <b>{dateLabel(doc.dueDate)}</b>
                </>
              )}
              {doc.status && (
                <span className={`preview-status preview-${doc.status}`}>
                  {doc.status.replaceAll("_", " ")}
                </span>
              )}
            </div>
          </div>
          <div className="data-table-wrap preview-table">
            <table>
              <thead>
                <tr>
                  {isChallan ? (
                    <>
                      <th>ITEM DESCRIPTION</th>
                      <th>HSN</th>
                      <th>QTY</th>
                      <th>UNIT</th>
                      <th className="right">RATE</th>
                      <th className="right">AMOUNT</th>
                    </>
                  ) : (
                    <>
                      <th>DESCRIPTION</th>
                      <th>QTY</th>
                      <th className="right">RATE</th>
                      <th className="right">AMOUNT</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {(record.items ?? []).map((item: any) => (
                  <tr key={item.id ?? item.name}>
                    <td>{item.name}</td>
                    {isChallan ? (
                      <>
                        <td>{item.hsn || "—"}</td>
                        <td>{Number(item.quantity)}</td>
                        <td>{item.unit || "pcs"}</td>
                        <td className="right">
                          {money(item.rate, data.data?.company.currency)}
                        </td>
                        <td className="right">
                          {money(
                            item.total ??
                              Number(item.quantity) * Number(item.rate ?? 0),
                            data.data?.company.currency
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{Number(item.quantity)}</td>
                        <td className="right">
                          {money(item.rate, data.data?.company.currency)}
                        </td>
                        <td className="right">
                          {money(
                            Number(item.quantity) *
                              Number(item.rate) *
                              (1 + Number(item.taxPercent) / 100),
                            data.data?.company.currency
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isChallan && (
            <div className="challan-preview-dispatch">
              <div>
                <small>PLACE OF DELIVERY</small>
                <b>{doc.placeOfDelivery || "—"}</b>
              </div>
              <div>
                <small>DELIVERY METHOD</small>
                <b>
                  {doc.dispatchMode === "transport"
                    ? "Via transport"
                    : "Hand delivery"}
                </b>
              </div>
              {doc.dispatchMode === "transport" && (
                <>
                  <div>
                    <small>DISPATCHED VIA</small>
                    <b>{doc.transporter || "—"}</b>
                  </div>
                  <div>
                    <small>VEHICLE NO.</small>
                    <b>{doc.vehicleNo || "—"}</b>
                  </div>
                  <div>
                    <small>E-WAY BILL NO.</small>
                    <b>{doc.ewayBillNo || "—"}</b>
                  </div>
                </>
              )}
            </div>
          )}
          {!isChallan && (
            <div className="document-preview-totals">
              <div>
                <span>Subtotal</span>
                <b>{money(doc.subtotal, data.data?.company.currency)}</b>
              </div>
              <div>
                <span>Tax</span>
                <b>{money(doc.taxTotal, data.data?.company.currency)}</b>
              </div>
              <div>
                <span>Discount</span>
                <b>− {money(doc.discount, data.data?.company.currency)}</b>
              </div>
              {Number(doc.amountPaid) > 0 && (
                <div>
                  <span>Paid to date</span>
                  <b>{money(doc.amountPaid, data.data?.company.currency)}</b>
                </div>
              )}
              <div className="preview-total">
                <span>
                  {doc.kind === "quotation" ? "Quotation total" : "Balance due"}
                </span>
                <b>
                  {money(
                    doc.kind === "quotation"
                      ? doc.total
                      : Math.max(0, Number(doc.total) - Number(doc.amountPaid)),
                    data.data?.company.currency
                  )}
                </b>
              </div>
            </div>
          )}
          {isChallan && (
            <div className="document-preview-totals">
              <div>
                <span>Total quantity</span>
                <b>{quantitySummary(record.items ?? [])}</b>
              </div>
              <div className="preview-total">
                <span>Total amount</span>
                <b>{money(doc.total, data.data?.company.currency)}</b>
              </div>
            </div>
          )}
          {doc.notes && (
            <p className="document-preview-note">
              <b>{isChallan ? "Remarks" : "Notes / terms"}</b>
              <span>{doc.notes}</span>
            </p>
          )}
        </div>
        <div className="document-preview-actions">
          <button
            className="quiet-btn"
            onClick={() => void makePdf(true)}
            disabled={!!busy}
          >
            {busy === "print" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Printer size={15} />
            )}{" "}
            Open PDF to print
          </button>
          <button
            className="primary-btn"
            onClick={() => void makePdf(false)}
            disabled={!!busy}
          >
            {busy === "download" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Download size={15} />
            )}{" "}
            Download PDF
          </button>
        </div>
      </div>
    </WorkspaceModal>
  );
}
