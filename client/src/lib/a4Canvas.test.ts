import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { normalizePdfToPortraitA4 } from "./a4Canvas";

describe("normalizePdfToPortraitA4", () => {
  it("fits every portrait or landscape source page onto the same A4 portrait canvas", async () => {
    const source = await PDFDocument.create();
    source.addPage([842, 595]).drawText("Landscape source page");
    source.addPage([595, 842]);

    const outputBytes = await normalizePdfToPortraitA4(await source.save());
    const output = await PDFDocument.load(outputBytes);

    expect(output.getPageCount()).toBe(2);
    for (const page of output.getPages()) {
      expect(page.getWidth()).toBeCloseTo((210 / 25.4) * 72, 2);
      expect(page.getHeight()).toBeCloseTo((297 / 25.4) * 72, 2);
      expect(page.getWidth()).toBeLessThan(page.getHeight());
    }
  });
});
