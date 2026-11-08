const A4_WIDTH = (210 / 25.4) * 72;
const A4_HEIGHT = (297 / 25.4) * 72;

/** Embed each source page, preserving valid but completely blank PDF pages. */
export async function embedPdfPagesPreservingBlanks(
  output: any,
  source: any
): Promise<Array<any | null>> {
  const backgrounds: Array<any | null> = [];
  for (const pageIndex of source.getPageIndices()) {
    source.getPage(pageIndex).drawRectangle({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      opacity: 0,
    });
    try {
      const [background] = await output.embedPdf(source, [pageIndex]);
      if (background) await background.embed();
      backgrounds.push(background ?? null);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("missing Contents")
      ) {
        throw error;
      }
      backgrounds.push(null);
    }
  }
  return backgrounds;
}

/** Fit each PDF source page onto a fixed portrait A4 canvas without distortion. */
export async function normalizePdfToPortraitA4(sourceBytes: Uint8Array) {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  const backgrounds = await embedPdfPagesPreservingBlanks(output, source);

  for (const background of backgrounds) {
    const page = output.addPage([A4_WIDTH, A4_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: A4_WIDTH,
      height: A4_HEIGHT,
      color: rgb(1, 1, 1),
    });
    if (!background) continue;
    const scale = Math.min(
      A4_WIDTH / background.width,
      A4_HEIGHT / background.height
    );
    const fittedWidth = background.width * scale;
    const fittedHeight = background.height * scale;
    page.drawPage(background, {
      x: (A4_WIDTH - fittedWidth) / 2,
      y: (A4_HEIGHT - fittedHeight) / 2,
      width: fittedWidth,
      height: fittedHeight,
    });
  }

  return output.save();
}
