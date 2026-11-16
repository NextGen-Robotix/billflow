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
    bankName?: string | null;
    bankBranch?: string | null;
    bankAccountName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    upiId?: string | null;
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

  if (data.kind === "invoice") {
    const taxInvoicePage = (await addPage(false)).page;
    const black = rgb(0.08, 0.08, 0.08);
    const white = rgb(1, 1, 1);
    const invoiceMargin = mm(10);
    const invoiceWidth = pageWidth - invoiceMargin * 2;
    let invoiceY = pageHeight - mm(12);

    const text = (
      value: unknown,
      x: number,
      y: number,
      size = 7,
      font = regular,
      width?: number
    ) => {
      const content = String(value ?? "");
      if (!content) return;
      if (width) {
        drawFittedText(taxInvoicePage, content, x, y, width, font, size, black);
      } else {
        taxInvoicePage.drawText(content, { x, y, size, font, color: black });
      }
    };
    const cell = (
      x: number,
      y: number,
      width: number,
      height: number,
      value = "",
      options: { bold?: boolean; align?: "left" | "center" | "right"; size?: number } = {}
    ) => {
      taxInvoicePage.drawRectangle({
        x,
        y,
        width,
        height,
        borderColor: black,
        borderWidth: 0.55,
        color: white,
      });
      const font = options.bold ? bold : regular;
      const size = options.size ?? 6.7;
      const valueWidth = font.widthOfTextAtSize(value, size);
      const contentWidth = width - mm(3);
      const drawX =
        options.align === "right"
          ? x + mm(1.5)
          : options.align === "center"
            ? x + (width - Math.min(valueWidth, contentWidth)) / 2
            : x + mm(1.5);
      drawFittedText(
        taxInvoicePage,
        value,
        drawX,
        y + height / 2 - size / 3,
        contentWidth,
        font,
        size,
        black,
        options.align === "right" ? "right" : "left"
      );
    };
    const columnX = (fractions: number[], index: number) =>
      invoiceMargin +
      invoiceWidth * fractions.slice(0, index).reduce((sum, part) => sum + part, 0);

    text("TAX INVOICE", pageWidth / 2 - mm(17), invoiceY, 11, bold);
    text("Original for Recipient", pageWidth - invoiceMargin - mm(36), invoiceY, 6.5);
    invoiceY -= mm(4);

    const companyHeight = mm(30);
    taxInvoicePage.drawRectangle({
      x: invoiceMargin,
      y: invoiceY - companyHeight,
      width: invoiceWidth,
      height: companyHeight,
      borderColor: black,
      borderWidth: 0.7,
      color: white,
    });
    text(data.company.name || "Business", invoiceMargin + mm(3), invoiceY - mm(8), 13, bold);
    const companyDetails = [
      data.company.gstNumber ? `GST Number : ${data.company.gstNumber}` : "",
      data.company.address,
      data.company.phone ? `Contact Number: ${data.company.phone}` : "",
    ].filter(Boolean);
    companyDetails.forEach((value, index) =>
      text(value, invoiceMargin + mm(3), invoiceY - mm(14 + index * 4), 6.4)
    );
    const metadataX = invoiceMargin + invoiceWidth * 0.68;
    text(`Invoice No : ${data.number}`, metadataX, invoiceY - mm(9), 7);
    text(`Invoice Date : ${dateLabel(data.date)}`, metadataX, invoiceY - mm(16), 7);
    invoiceY -= companyHeight;

    const partyHeight = mm(31);
    const partyWidth = invoiceWidth / 2;
    const drawParty = (x: number, title: string) => {
      taxInvoicePage.drawRectangle({
        x,
        y: invoiceY - partyHeight,
        width: partyWidth,
        height: partyHeight,
        borderColor: black,
        borderWidth: 0.55,
        color: white,
      });
      text(title, x + partyWidth / 2 - mm(24), invoiceY - mm(5), 7, bold, mm(48));
      const customer = data.customer;
      const lines = [
        `Name : ${customer?.name || "—"}`,
        `Address : ${customer?.address || "—"}`,
        `Contact No : ${customer?.phone || "—"}`,
        `GST No : ${customer?.taxId || "—"}`,
      ];
      lines.forEach((value, index) =>
        text(value, x + mm(3), invoiceY - mm(12 + index * 4.5), 6.2)
      );
    };
    drawParty(invoiceMargin, "Detail of Receiver (Billed to)");
    drawParty(invoiceMargin + partyWidth, "Detail of Consignee (Shipped to)");
    invoiceY -= partyHeight;

    const fractions = [0.055, 0.22, 0.11, 0.095, 0.13, 0.13, 0.065, 0.11, 0.085];
    const headers = [
      "No",
      "Item Name",
      "HSN Code",
      "Qty (Unit)",
      "Rate",
      "Amount",
      "GST %",
      "GST Amount",
      "Total",
    ];
    const headerHeight = mm(13);
    let x = invoiceMargin;
    headers.forEach((header, index) => {
      const width = invoiceWidth * fractions[index];
      cell(x, invoiceY - headerHeight, width, headerHeight, header, {
        bold: true,
        align: "center",
        size: 6.1,
      });
      x += width;
    });
    invoiceY -= headerHeight;

    const itemRows = data.items.map((item, index) => {
      const quantity = num(item.quantity);
      const rate = num(item.rate);
      const base = quantity * rate;
      const tax = base * (num(item.taxPercent) / 100);
      return {
        item,
        index,
        quantity,
        rate,
        base,
        tax,
        total: base + tax,
      };
    });
    const rowHeight = mm(10);
    itemRows.forEach(row => {
      let itemX = invoiceMargin;
      const values = [
        `${row.index + 1}.`,
        row.item.name,
        row.item.hsn || "—",
        `${row.quantity} ${row.item.unit || ""}`.trim(),
        currency(row.rate, data.company.currency),
        currency(row.base, data.company.currency),
        `${num(row.item.taxPercent).toFixed(2)}`,
        currency(row.tax, data.company.currency),
        currency(row.total, data.company.currency),
      ];
      values.forEach((value, index) => {
        const width = invoiceWidth * fractions[index];
        cell(itemX, invoiceY - rowHeight, width, rowHeight, value, {
          align: index === 1 || index === 2 ? "left" : "right",
          size: 6.2,
        });
        itemX += width;
      });
      invoiceY -= rowHeight;
    });

    const subtotal = itemRows.reduce((sum, row) => sum + row.base, 0);
    const taxTotal = itemRows.reduce((sum, row) => sum + row.tax, 0);
    const discount = num(data.discount);
    const total = Math.max(0, subtotal + taxTotal - discount);
    const quantityTotal = itemRows.reduce((sum, row) => sum + row.quantity, 0);
    const subtotalValues = [
      "Subtotal",
      `${quantityTotal}`,
      currency(subtotal, data.company.currency),
      currency(taxTotal, data.company.currency),
      currency(total, data.company.currency),
    ];
    let subtotalX = invoiceMargin;
    fractions.forEach((fraction, index) => {
      const width = invoiceWidth * fraction;
      const value =
        index === 1
          ? subtotalValues[1]
          : index === 4
            ? subtotalValues[2]
            : index === 7
              ? subtotalValues[3]
              : index === 8
                ? subtotalValues[4]
                : index === 0
                  ? subtotalValues[0]
                  : "";
      cell(subtotalX, invoiceY - rowHeight, width, rowHeight, value, {
        bold: true,
        align: index === 0 ? "left" : "right",
        size: 6.2,
      });
      subtotalX += width;
    });
    invoiceY -= rowHeight;

    const summaryHeight = mm(38);
    const summaryLeftWidth = invoiceWidth * 0.58;
    const summaryRightWidth = invoiceWidth - summaryLeftWidth;
    const leftLines = [
      `Total Amount In Word : ${currency(total, data.company.currency)}`,
      data.company.bankName ? `Bank Name: ${data.company.bankName}` : "",
      data.company.bankBranch ? `Branch Name: ${data.company.bankBranch}` : "",
      data.company.bankAccountName
        ? `Account Name: ${data.company.bankAccountName}`
        : "",
      data.company.bankAccountNumber
        ? `Account Number: ${data.company.bankAccountNumber}`
        : "",
      data.company.bankIfsc ? `IFSC Code: ${data.company.bankIfsc}` : "",
      data.company.upiId ? `UPI ID: ${data.company.upiId}` : "",
    ].filter(Boolean);
    taxInvoicePage.drawRectangle({
      x: invoiceMargin,
      y: invoiceY - summaryHeight,
      width: summaryLeftWidth,
      height: summaryHeight,
      borderColor: black,
      borderWidth: 0.55,
      color: white,
    });
    leftLines.forEach((value, index) =>
      text(value, invoiceMargin + mm(3), invoiceY - mm(6 + index * 4.5), 6.1, index === 0 ? bold : regular)
    );
    const summaryRows = [
      ["Subtotal :", currency(subtotal, data.company.currency)],
      ["CGST Amount :", currency(taxTotal / 2, data.company.currency)],
      ["SGST Amount :", currency(taxTotal / 2, data.company.currency)],
      ["Round Off :", currency(0, data.company.currency)],
      ["Total :", currency(total, data.company.currency)],
    ];
    const summaryRowHeight = summaryHeight / summaryRows.length;
    summaryRows.forEach((row, index) => {
      const rowY = invoiceY - summaryRowHeight * (index + 1);
      cell(invoiceMargin + summaryLeftWidth, rowY, summaryRightWidth * 0.58, summaryRowHeight, row[0], {
        bold: index === summaryRows.length - 1,
        size: 6.2,
      });
      cell(
        invoiceMargin + summaryLeftWidth + summaryRightWidth * 0.58,
        rowY,
        summaryRightWidth * 0.42,
        summaryRowHeight,
        row[1],
        { bold: index === summaryRows.length - 1, align: "right", size: 6.2 }
      );
    });
    invoiceY -= summaryHeight;

    const footerHeight = mm(20);
    const footerParts = [
      ["Notes:", data.notes || "Thank you for your business."],
      ["Terms and Conditions:", "Goods once sold will not be taken back."],
      ["", "For, " + (data.company.name || "Business")],
    ];
    let footerX = invoiceMargin;
    footerParts.forEach(([label, value], index) => {
      const width = invoiceWidth * (index === 2 ? 0.25 : 0.375);
      cell(footerX, invoiceY - footerHeight, width, footerHeight, "", { size: 6 });
      text(label, footerX + mm(2), invoiceY - mm(5), 6.1, bold);
      for (const [lineIndex, line] of wrap(value, width - mm(4), 6, regular).slice(0, 3).entries())
        text(line, footerX + mm(2), invoiceY - mm(10 + lineIndex * 3.6), 6);
      footerX += width;
    });
    text("Authorized Signatory", invoiceMargin + invoiceWidth * 0.75 + mm(8), invoiceY - mm(16), 6.1, bold);
    return await pdf.save();
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
            "Quotation total",
            currency(num(data.total), data.company.currency),
          ],
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
