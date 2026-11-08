export type BankStatementTransaction = {
  transactionDate: string;
  direction: "credit" | "debit";
  amount: number | string;
  balanceAfter: number | string;
  method: string;
  methodOther?: string | null;
  purposeCategory: string;
  purposeOther?: string | null;
  counterparty?: string | null;
  reference?: string | null;
};

export type BankStatementData = {
  companyName: string;
  currency: string;
  periodLabel: string;
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  credits: number;
  debits: number;
  transactions: BankStatementTransaction[];
};

const dateLabel = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function formattedMoney(amount: unknown, currencyCode: string) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode || "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount ?? 0));
  } catch {
    return `INR ${Number(amount ?? 0).toFixed(2)}`;
  }
}

export async function buildBankStatementPdf(data: BankStatementData) {
  const [pdfLibrary, fontkitModule] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const { PDFDocument, rgb } = pdfLibrary;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitModule.default);
  const [regularResponse, boldResponse] = await Promise.all([
    fetch("/fonts/NotoSans-Regular.ttf", { cache: "force-cache" }),
    fetch("/fonts/NotoSans-Bold.ttf", { cache: "force-cache" }),
  ]);
  if (!regularResponse.ok || !boldResponse.ok)
    throw new Error("Bank statement PDF fonts could not be loaded.");
  const [regularBytes, boldBytes] = await Promise.all([
    regularResponse.arrayBuffer(),
    boldResponse.arrayBuffer(),
  ]);
  const regular = await pdf.embedFont(new Uint8Array(regularBytes), {
    subset: true,
  });
  const bold = await pdf.embedFont(new Uint8Array(boldBytes), { subset: true });

  const pageWidth = 210 * (72 / 25.4);
  const pageHeight = 297 * (72 / 25.4);
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;
  const ink = rgb(0.08, 0.13, 0.17);
  const muted = rgb(0.38, 0.45, 0.48);
  const line = rgb(0.82, 0.85, 0.86);
  const pale = rgb(0.95, 0.97, 0.97);
  const teal = rgb(0.02, 0.48, 0.45);
  const gold = rgb(0.72, 0.49, 0.05);
  const red = rgb(0.72, 0.18, 0.24);
  const fmt = (value: unknown) => formattedMoney(value, data.currency);
  const pages: ReturnType<typeof pdf.addPage>[] = [];
  let y = 0;
  let pageNumber = 0;

  const drawTextFit = (
    page: ReturnType<typeof pdf.addPage>,
    text: string,
    x: number,
    baseline: number,
    width: number,
    font: typeof regular,
    size: number,
    color: typeof ink,
    align: "left" | "right" = "left"
  ) => {
    let fitted = size;
    while (fitted > 5.5 && font.widthOfTextAtSize(text, fitted) > width)
      fitted -= 0.25;
    const textWidth = font.widthOfTextAtSize(text, fitted);
    page.drawText(text, {
      x: align === "right" ? x + Math.max(0, width - textWidth) : x,
      y: baseline,
      size: fitted,
      font,
      color,
      maxWidth: width,
    });
  };

  const columns = [58, 165, 69, 67, 67, contentWidth - 426];
  const drawTableHeader = (page: ReturnType<typeof pdf.addPage>) => {
    const headerHeight = 22;
    page.drawRectangle({
      x: margin,
      y: y - headerHeight + 2,
      width: contentWidth,
      height: headerHeight,
      color: pale,
    });
    const labels = [
      "DATE",
      "PURPOSE / COUNTERPARTY",
      "METHOD",
      "CREDIT",
      "DEBIT",
      "BALANCE",
    ];
    let x = margin + 6;
    labels.forEach((label, index) => {
      const rightAligned = index >= 3;
      const width = columns[index] - 8;
      drawTextFit(
        page,
        label,
        rightAligned ? x + 2 : x,
        y - 12,
        width,
        bold,
        6.6,
        muted,
        rightAligned ? "right" : "left"
      );
      x += columns[index];
    });
    y -= headerHeight;
  };

  const addPage = (first = false) => {
    const page = pdf.addPage([pageWidth, pageHeight]);
    pages.push(page);
    pageNumber += 1;
    y = pageHeight - 38;
    drawTextFit(
      page,
      data.companyName || "BillFlow workspace",
      margin,
      y,
      contentWidth * 0.53,
      bold,
      13,
      ink
    );
    drawTextFit(
      page,
      "CURRENT ACCOUNT · BANK STATEMENT",
      margin + contentWidth * 0.55,
      y + 1,
      contentWidth * 0.45,
      bold,
      8,
      teal,
      "right"
    );
    y -= 23;
    page.drawText(
      `${data.periodLabel}  |  ${dateLabel(data.from)} – ${dateLabel(data.to)}`,
      {
        x: margin,
        y,
        size: 8,
        font: regular,
        color: muted,
        maxWidth: contentWidth,
      }
    );
    y -= 26;

    if (first) {
      const summaryGap = 8;
      const summaryWidth = (contentWidth - summaryGap * 3) / 4;
      const summaries = [
        {
          label: "OPENING BALANCE",
          value: fmt(data.openingBalance),
          color: ink,
        },
        { label: "CREDITS", value: fmt(data.credits), color: gold },
        { label: "DEBITS", value: fmt(data.debits), color: red },
        {
          label: "CLOSING BALANCE",
          value: fmt(data.closingBalance),
          color: teal,
        },
      ];
      summaries.forEach((summary, index) => {
        const x = margin + index * (summaryWidth + summaryGap);
        page.drawRectangle({
          x,
          y: y - 45,
          width: summaryWidth,
          height: 45,
          color: pale,
          borderColor: line,
          borderWidth: 0.6,
        });
        page.drawText(summary.label, {
          x: x + 7,
          y: y - 14,
          size: 6,
          font: bold,
          color: muted,
        });
        drawTextFit(
          page,
          summary.value,
          x + 7,
          y - 33,
          summaryWidth - 14,
          bold,
          8,
          summary.color
        );
      });
      y -= 61;
      page.drawText("TRANSACTION LEDGER", {
        x: margin,
        y,
        size: 7,
        font: bold,
        color: muted,
      });
      y -= 10;
    } else {
      page.drawText("TRANSACTION LEDGER · CONTINUED", {
        x: margin,
        y,
        size: 7,
        font: bold,
        color: muted,
      });
      y -= 12;
    }
    drawTableHeader(page);
  };

  addPage(true);
  if (!data.transactions.length) {
    pages[0].drawText("No transactions in this period.", {
      x: margin + 6,
      y: y - 18,
      size: 8,
      font: regular,
      color: muted,
    });
    y -= 30;
  }
  for (const transaction of data.transactions) {
    if (y < 54) addPage(false);
    const page = pages[pages.length - 1];
    const rowHeight = 24;
    const amount = Number(transaction.amount ?? 0);
    const purpose =
      transaction.purposeCategory === "Other"
        ? transaction.purposeOther || "Other"
        : transaction.purposeCategory;
    const method =
      transaction.method === "Other"
        ? transaction.methodOther || "Other"
        : transaction.method;
    const description = [
      purpose,
      transaction.counterparty,
      transaction.reference ? `Ref ${transaction.reference}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    let x = margin + 6;
    const fields = [
      {
        text: dateLabel(transaction.transactionDate),
        align: "left" as const,
        color: ink,
      },
      { text: description, align: "left" as const, color: ink },
      { text: method, align: "left" as const, color: muted },
      {
        text: transaction.direction === "credit" ? fmt(amount) : "—",
        align: "right" as const,
        color: gold,
      },
      {
        text: transaction.direction === "debit" ? fmt(amount) : "—",
        align: "right" as const,
        color: red,
      },
      {
        text: fmt(transaction.balanceAfter),
        align: "right" as const,
        color: ink,
      },
    ];
    fields.forEach((field, index) => {
      drawTextFit(
        page,
        field.text,
        field.align === "right" ? x + 2 : x,
        y - 14,
        columns[index] - 8,
        regular,
        6.7,
        field.color,
        field.align
      );
      x += columns[index];
    });
    page.drawLine({
      start: { x: margin, y: y - rowHeight },
      end: { x: margin + contentWidth, y: y - rowHeight },
      thickness: 0.45,
      color: line,
    });
    y -= rowHeight;
  }

  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: margin, y: 31 },
      end: { x: margin + contentWidth, y: 31 },
      thickness: 0.55,
      color: line,
    });
    page.drawText("BillFlow · bank records maintained by your workspace", {
      x: margin,
      y: 18,
      size: 6.5,
      font: regular,
      color: muted,
    });
    drawTextFit(
      page,
      `Page ${index + 1}`,
      margin + contentWidth - 52,
      18,
      52,
      regular,
      6.5,
      muted,
      "right"
    );
  });

  return pdf.save();
}
