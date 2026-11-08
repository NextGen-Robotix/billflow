export type OutputKind = "invoice" | "quotation" | "delivery_challan";
export type BillFlowOutput = {
  kind: OutputKind;
  number: string;
  date: string;
  dueDate?: string | null;
  status?: string;
  subtotal?: number;
  taxTotal?: number;
  discount?: number;
  total: number;
  amountPaid?: number;
  notes?: string | null;
  placeOfDelivery?: string | null;
  dispatchMode?: "hand" | "transport";
  transporter?: string | null;
  vehicleNo?: string | null;
  ewayBillNo?: string | null;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    taxId?: string | null;
  } | null;
  company: {
    name: string;
    email?: string | null;
    currency?: string;
    address?: string | null;
    phone?: string | null;
    gstNumber?: string | null;
  };
  items: Array<{
    name: string;
    hsn?: string | null;
    quantity: number | string;
    unit?: string | null;
    rate?: number | string;
    taxPercent?: number | string;
    total?: number | string;
  }>;
  reservedTopMm?: number;
  reservedBottomMm?: number;
  letterheadBase64?: string | null;
  logoBase64?: string | null;
};

const mm = (value: number) => (value * 72) / 25.4;
const num = (value: unknown) => Number(value ?? 0);
let colors: Record<string, any> = {};

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function drawFittedText(
  page: any,
  text: string,
  x: number,
  y: number,
  width: number,
  font: any,
  size: number,
  color: any,
  align: "left" | "right" = "left"
) {
  let fittedSize = size;
  while (fittedSize > 6 && font.widthOfTextAtSize(text, fittedSize) > width)
    fittedSize -= 0.25;
  const textWidth = font.widthOfTextAtSize(text, fittedSize);
  page.drawText(text, {
    x: align === "right" ? x + Math.max(0, width - textWidth) : x,
    y,
    size: fittedSize,
    font,
    color,
    maxWidth: width,
  });
}

async function fetchFont(file: string) {
  const response = await fetch(`/fonts/${file}`, { cache: "force-cache" });
  if (!response.ok) throw new Error("BillFlow PDF fonts could not be loaded.");
  return new Uint8Array(await response.arrayBuffer());
}

function currency(amount: number, code = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code || "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `INR ${new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.valueOf())
    ? value.slice(0, 10)
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function quantitySummary(items: BillFlowOutput["items"]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    const unit = String(item.unit || "pcs").trim() || "pcs";
    totals.set(unit, (totals.get(unit) ?? 0) + num(item.quantity));
  }
  return (
    [...totals.entries()]
      .map(
        ([unit, quantity]) => `${Math.round(quantity * 1000) / 1000} ${unit}`
      )
      .join(" · ") || "0"
  );
}

type Cursor = { page: any; y: number; pageIndex: number };

export async function buildBillFlowPdf(data: BillFlowOutput) {
  const [pdfLibrary, fontkitModule] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const { PDFDocument, rgb } = pdfLibrary;
  const fontkit = fontkitModule.default;
  colors = {
    ink: rgb(0.1, 0.15, 0.18),
    muted: rgb(0.39, 0.45, 0.47),
    line: rgb(0.79, 0.82, 0.82),
    accent: rgb(0.0, 0.5, 0.49),
    soft: rgb(0.94, 0.96, 0.96),
  };
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    fetchFont("NotoSans-Regular.ttf"),
    fetchFont("NotoSans-Bold.ttf"),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const sourceLetterhead = data.letterheadBase64
    ? await PDFDocument.load(fromBase64(data.letterheadBase64))
    : null;
  const { embedPdfPagesPreservingBlanks } = await import("./a4Canvas");
  const backgroundPages = sourceLetterhead
    ? await embedPdfPagesPreservingBlanks(pdf, sourceLetterhead)
    : [];
  const reservedTop = mm(
    data.reservedTopMm ?? (backgroundPages.length ? 38 : 14)
  );
  const reservedBottom = mm(
    data.reservedBottomMm ?? (backgroundPages.length ? 24 : 16)
  );
  const pageWidth = mm(210);
  const pageHeight = mm(297);
  if (reservedTop + reservedBottom > pageHeight - mm(55))
    throw new Error(
      "Reserved letterhead space leaves too little room for document content."
    );
  const margin = Math.min(48, pageWidth * 0.085);
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = reservedBottom + mm(12);
  const title =
    data.kind === "delivery_challan"
      ? "DELIVERY CHALLAN"
      : data.kind.toUpperCase();
  const logoBytes = data.logoBase64 ? fromBase64(data.logoBase64) : null;
  let logo: any = null;
  if (logoBytes) {
    try {
      logo =
        logoBytes[0] === 0x89
          ? await pdf.embedPng(logoBytes)
          : await pdf.embedJpg(logoBytes);
    } catch {
      logo = null;
    }
  }

  const addPage = async (withHeader = true): Promise<Cursor> => {
    const pageIndex = pdf.getPageCount();
    const page = pdf.addPage([pageWidth, pageHeight]);
    if (backgroundPages.length) {
      const background =
        backgroundPages[Math.min(pageIndex, backgroundPages.length - 1)];
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        color: rgb(1, 1, 1),
      });
      if (background) {
        const scale = Math.min(
          pageWidth / background.width,
          pageHeight / background.height
        );
        const backgroundWidth = background.width * scale;
        const backgroundHeight = background.height * scale;
        page.drawPage(background, {
          x: (pageWidth - backgroundWidth) / 2,
          y: (pageHeight - backgroundHeight) / 2,
          width: backgroundWidth,
          height: backgroundHeight,
        });
      }
    }
    let y = pageHeight - reservedTop - mm(7);
    if (withHeader) {
      const headerTop = pageHeight - reservedTop - mm(5);
      const companyWidth = contentWidth * 0.66;
      const logoBox = mm(16);
      const companyTextX = margin + (logo ? mm(21) : 0);
      const companyTextWidth = companyWidth - (companyTextX - margin);
      if (logo) {
        const logoScale = Math.min(
          logoBox / logo.width,
          logoBox / logo.height,
          1
        );
        const logoWidth = logo.width * logoScale;
        const logoHeight = logo.height * logoScale;
        page.drawImage(logo, {
          x: margin,
          y: headerTop - mm(21) + (logoBox - logoHeight) / 2,
          width: logoWidth,
          height: logoHeight,
        });
      }
      drawFittedText(
        page,
        data.company.name || "Business",
        companyTextX,
        headerTop - mm(10),
        companyTextWidth,
        bold,
        12,
        colors.ink
      );
      const companyLines = [
        data.company.address?.replace(/\s+/g, " ").trim(),
        [
          data.company.phone ? `Phone: ${data.company.phone}` : "",
          data.company.email ? `Email: ${data.company.email}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        data.company.gstNumber ? `GSTIN: ${data.company.gstNumber}` : "",
      ].filter(Boolean);
      const detailLines = companyLines.flatMap(line =>
        wrap(line!, companyTextWidth, 7.2, regular)
      );
      const visibleDetails = detailLines.slice(0, 5);
      if (detailLines.length > visibleDetails.length)
        visibleDetails[visibleDetails.length - 1] = `${visibleDetails.at(-1)}…`;
      let companyBottom = headerTop - mm(14);
      for (const line of visibleDetails) {
        companyBottom -= mm(4);
        page.drawText(line, {
          x: companyTextX,
          y: companyBottom,
          size: 7.2,
          font: regular,
          color: colors.muted,
          maxWidth: companyTextWidth,
        });
      }
      const documentX = margin + contentWidth * 0.69;
      const documentWidth = contentWidth * 0.31;
      drawFittedText(
        page,
        title,
        documentX,
        headerTop - mm(9),
        documentWidth,
        bold,
        8.5,
        colors.accent,
        "right"
      );
      drawFittedText(
        page,
        data.number,
        documentX,
        headerTop - mm(16),
        documentWidth,
        bold,
        11,
        colors.ink,
        "right"
      );
      const dividerY = Math.min(companyBottom - mm(4), headerTop - mm(25));
      page.drawLine({
        start: { x: margin, y: dividerY },
        end: { x: pageWidth - margin, y: dividerY },
        thickness: 0.8,
        color: colors.line,
      });
      y = dividerY - mm(8);
      const customer = data.customer;
      const customerWidth = contentWidth * 0.63;
      page.drawText(
        data.kind === "delivery_challan"
          ? "DELIVERY CHALLAN FOR"
          : "BILL TO / DELIVER TO",
        {
          x: margin,
          y: y - 4,
          size: 7.5,
          font: bold,
          color: colors.muted,
        }
      );
      const customerName = customer?.name || "Customer";
      const customerNameLines = wrap(customerName, customerWidth, 10, bold);
      let customerY = y - mm(7);
      for (const line of customerNameLines) {
        page.drawText(line, {
          x: margin,
          y: customerY,
          size: 10,
          font: bold,
          color: colors.ink,
          maxWidth: customerWidth,
        });
        customerY -= mm(5);
      }
      const customerLines = [
        customer?.address?.replace(/\s+/g, " ").trim(),
        customer?.phone,
        customer?.email,
        customer?.taxId ? `GSTIN / Tax ID: ${customer.taxId}` : "",
      ].filter(Boolean) as string[];
      for (const line of customerLines) {
        for (const wrapped of wrap(line, customerWidth, 7.6, regular).slice(
          0,
          5
        )) {
          customerY -= mm(4);
          page.drawText(wrapped, {
            x: margin,
            y: customerY,
            size: 7.6,
            font: regular,
            color: colors.muted,
            maxWidth: customerWidth,
          });
        }
      }
      const metaX = margin + contentWidth * 0.7;
      const metaWidth = contentWidth * 0.3;
      page.drawText(
        data.kind === "delivery_challan" ? "CHALLAN DATE" : "ISSUE DATE",
        { x: metaX, y: y - 4, size: 7, font: bold, color: colors.muted }
      );
      drawFittedText(
        page,
        dateLabel(data.date),
        metaX,
        y - mm(8),
        metaWidth,
        regular,
        8.5,
        colors.ink
      );
      if (data.kind !== "delivery_challan") {
        page.drawText("DUE DATE", {
          x: metaX,
          y: y - mm(16),
          size: 7,
          font: bold,
          color: colors.muted,
        });
        drawFittedText(
          page,
          dateLabel(data.dueDate),
          metaX,
          y - mm(20),
          metaWidth,
          regular,
          8.5,
          colors.ink
        );
      } else if (data.placeOfDelivery) {
        page.drawText("PLACE OF DELIVERY", {
          x: metaX,
          y: y - mm(16),
          size: 7,
          font: bold,
          color: colors.muted,
        });
        drawFittedText(
          page,
          data.placeOfDelivery,
          metaX,
          y - mm(20),
          metaWidth,
          regular,
          8,
          colors.ink
        );
      }
      y = Math.min(customerY - mm(4), y - mm(27));
      y = drawTableHeader(page, y, data.kind, margin, contentWidth, bold);
    }
    return { page, y, pageIndex };
  };

  function drawTableHeader(
    page: any,
    y: number,
    kind: OutputKind,
    x: number,
    width: number,
    font: any
  ) {
    const columns =
      kind === "delivery_challan"
        ? ["ITEM DESCRIPTION", "HSN", "QTY", "UNIT", "RATE", "AMOUNT"]
        : ["DESCRIPTION", "QTY", "RATE", "TAX", "AMOUNT"];
    const fractions =
      kind === "delivery_challan"
        ? [0.33, 0.14, 0.09, 0.11, 0.15, 0.18]
        : [0.44, 0.12, 0.16, 0.12, 0.16];
    page.drawRectangle({
      x,
      y: y - mm(8),
      width,
      height: mm(8),
      color: colors.soft,
    });
    let columnX = x + mm(3);
    columns.forEach((label, index) => {
      const columnWidth = width * fractions[index];
      const labelSize = 7.2;
      const textWidth = font.widthOfTextAtSize(label, labelSize);
      const labelX =
        index === 0 ? columnX : columnX + columnWidth - mm(5) - textWidth;
      page.drawText(label, {
        x: labelX,
        y: y - mm(5.4),
        size: labelSize,
        font,
        color: colors.ink,
        maxWidth: columnWidth - mm(5),
      });
      columnX += columnWidth;
    });
    page.drawLine({
      start: { x, y: y - mm(8) },
      end: { x: x + width, y: y - mm(8) },
      thickness: 0.7,
      color: colors.line,
    });
    return y - mm(8);
  }

  let cursor = await addPage(true);
  const fractions =
    data.kind === "delivery_challan"
      ? [0.33, 0.14, 0.09, 0.11, 0.15, 0.18]
      : [0.44, 0.12, 0.16, 0.12, 0.16];
  for (const item of data.items) {
    const nameLines = wrap(
      item.name,
      contentWidth * fractions[0] - mm(12),
      8.2,
      regular
    );
    const rowHeight = Math.max(mm(9), nameLines.length * mm(4.5) + mm(4));
    if (cursor.y - rowHeight < bottomLimit) cursor = await addPage(true);
    const top = cursor.y - mm(5.5);
    nameLines.forEach((line, index) =>
      cursor.page.drawText(line, {
        x: margin + mm(3),
        y: top - index * mm(4.5),
        size: 8.2,
        font: regular,
        color: colors.ink,
        maxWidth: contentWidth * fractions[0] - mm(12),
      })
    );
    if (data.kind === "delivery_challan") {
      drawRight(
        cursor.page,
        item.hsn || "—",
        margin,
        contentWidth,
        fractions,
        1,
        top,
        regular,
        7.5
      );
      drawRight(
        cursor.page,
        String(item.quantity),
        margin,
        contentWidth,
        fractions,
        2,
        top,
        regular,
        8.2
      );
      drawRight(
        cursor.page,
        item.unit || "pcs",
        margin,
        contentWidth,
        fractions,
        3,
        top,
        regular,
        7.5
      );
      drawRight(
        cursor.page,
        currency(num(item.rate), data.company.currency),
        margin,
        contentWidth,
        fractions,
        4,
        top,
        regular,
        7.8
      );
      drawRight(
        cursor.page,
        currency(
          num(item.total) || num(item.quantity) * num(item.rate),
          data.company.currency
        ),
        margin,
        contentWidth,
        fractions,
        5,
        top,
        regular,
        8.2
      );
    } else {
      const rate = num(item.rate);
      const quantity = num(item.quantity);
      const tax = num(item.taxPercent);
      drawRight(
        cursor.page,
        String(item.quantity),
        margin,
        contentWidth,
        fractions,
        1,
        top,
        regular,
        8.2
      );
      drawRight(
        cursor.page,
        currency(rate, data.company.currency),
        margin,
        contentWidth,
        fractions,
        2,
        top,
        regular,
        8.2
      );
      drawRight(
        cursor.page,
        `${tax.toFixed(2)}%`,
        margin,
        contentWidth,
        fractions,
        3,
        top,
        regular,
        8.2
      );
      drawRight(
        cursor.page,
        currency(quantity * rate * (1 + tax / 100), data.company.currency),
        margin,
        contentWidth,
        fractions,
        4,
        top,
        regular,
        8.2
      );
    }
    cursor.page.drawLine({
      start: { x: margin, y: cursor.y - rowHeight },
      end: { x: margin + contentWidth, y: cursor.y - rowHeight },
      thickness: 0.45,
      color: colors.line,
    });
    cursor.y -= rowHeight;
  }

  if (cursor.y - mm(48) < bottomLimit) cursor = await addPage(false);
  cursor.y -= mm(8);
  const totalX = margin + contentWidth * 0.55;
  const totalWidth = contentWidth * 0.45;
  const rows =
    data.kind === "delivery_challan"
      ? [
          ["Total quantity", quantitySummary(data.items)],
          ["Total amount", currency(num(data.total), data.company.currency)],
        ]
      : [
          ["Subtotal", currency(num(data.subtotal), data.company.currency)],
          ["Tax", currency(num(data.taxTotal), data.company.currency)],
          [
            "Discount",
            `− ${currency(num(data.discount), data.company.currency)}`,
          ],
          [
            data.kind === "quotation" ? "Quotation total" : "Invoice total",
            currency(num(data.total), data.company.currency),
          ],
          ...(data.kind === "invoice" && num(data.amountPaid) > 0
            ? [
                [
                  "Paid to date",
                  currency(num(data.amountPaid), data.company.currency),
                ],
                [
                  "Balance due",
                  currency(
                    Math.max(0, num(data.total) - num(data.amountPaid)),
                    data.company.currency
                  ),
                ],
              ]
            : []),
        ];
  for (let index = 0; index < rows.length; index++) {
    if (cursor.y - mm(7) < bottomLimit) cursor = await addPage(false);
    const isFinal =
      index === rows.length - 1 ||
      (data.kind !== "delivery_challan" && rows[index][0] === "Balance due");
    const [label, value] = rows[index];
    if (isFinal)
      cursor.page.drawRectangle({
        x: totalX,
        y: cursor.y - mm(8),
        width: totalWidth,
        height: mm(8),
        color: colors.soft,
      });
    cursor.page.drawText(label, {
      x: totalX + mm(3),
      y: cursor.y - mm(5.6),
      size: isFinal ? 9.2 : 8,
      font: isFinal ? bold : regular,
      color: isFinal ? colors.ink : colors.muted,
    });
    const valueFont = isFinal ? bold : regular;
    const valueSize = isFinal ? 9.2 : 8;
    const valueWidth = valueFont.widthOfTextAtSize(value, valueSize);
    cursor.page.drawText(value, {
      x: totalX + totalWidth - mm(3) - valueWidth,
      y: cursor.y - mm(5.6),
      size: valueSize,
      font: valueFont,
      color: isFinal ? colors.accent : colors.ink,
    });
    cursor.y -= mm(9);
  }
  if (data.kind === "delivery_challan") {
    const dispatchLines = [
      `Place of delivery: ${data.placeOfDelivery || "—"}`,
      `Delivery method: ${data.dispatchMode === "transport" ? "Via transport" : "Hand delivery"}`,
      ...(data.dispatchMode === "transport"
        ? [
            `Dispatched via: ${data.transporter || "—"}`,
            `Vehicle no.: ${data.vehicleNo || "—"}`,
            `E-way bill no.: ${data.ewayBillNo || "—"}`,
          ]
        : []),
    ];
    const blockHeight = mm(10 + dispatchLines.length * 5);
    if (cursor.y - blockHeight < bottomLimit) cursor = await addPage(false);
    cursor.page.drawRectangle({
      x: margin,
      y: cursor.y - blockHeight,
      width: contentWidth,
      height: blockHeight,
      color: colors.soft,
    });
    cursor.page.drawText("DISPATCH DETAILS", {
      x: margin + mm(3),
      y: cursor.y - mm(6),
      size: 7.3,
      font: bold,
      color: colors.muted,
    });
    let dispatchY = cursor.y - mm(10);
    for (const dispatchLine of dispatchLines) {
      for (const line of wrap(
        dispatchLine,
        contentWidth - mm(6),
        7.8,
        regular
      )) {
        cursor.page.drawText(line, {
          x: margin + mm(3),
          y: dispatchY - 7,
          size: 7.8,
          font: regular,
          color: colors.ink,
        });
        dispatchY -= mm(4.5);
      }
    }
    cursor.y -= blockHeight + mm(5);
  }
  if (data.notes) {
    if (cursor.y - mm(18) < bottomLimit) cursor = await addPage(false);
    cursor.y -= mm(4);
    cursor.page.drawText(
      data.kind === "delivery_challan" ? "REMARKS" : "NOTES / TERMS",
      { x: margin, y: cursor.y - 7, size: 7.5, font: bold, color: colors.muted }
    );
    cursor.y -= mm(5);
    for (const line of wrap(data.notes, contentWidth, 8, regular)) {
      if (cursor.y - mm(5) < bottomLimit) cursor = await addPage(false);
      cursor.page.drawText(line, {
        x: margin,
        y: cursor.y - 8,
        size: 8,
        font: regular,
        color: colors.ink,
      });
      cursor.y -= mm(4.5);
    }
  }
  return await pdf.save();
}

function drawRight(
  page: any,
  value: string,
  left: number,
  width: number,
  fractions: number[],
  index: number,
  y: number,
  font: any,
  size: number
) {
  const x = left + width * fractions.slice(0, index).reduce((a, b) => a + b, 0);
  const columnWidth = width * fractions[index];
  let drawSize = size;
  while (
    drawSize > 6 &&
    font.widthOfTextAtSize(value, drawSize) > columnWidth - mm(4)
  )
    drawSize -= 0.25;
  const textWidth = font.widthOfTextAtSize(value, drawSize);
  page.drawText(value, {
    x: x + columnWidth - mm(3) - textWidth,
    y: y - drawSize,
    size: drawSize,
    font,
    color: colors.ink,
  });
}

function wrap(text: string, width: number, size: number, font: any) {
  const lines: string[] = [];
  let current = "";
  for (const word of String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
