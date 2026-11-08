import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { collection, getDb, insertRecord, nextId } from "./mongoDb";
import { storageGet, storageGetSignedUrl, storagePut } from "./storage";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_LOGO_BYTES = 4 * 1024 * 1024;
const base64Field = z.string().min(1).max(12_000_000);

async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "BillFlow database is unavailable.",
    });
  return db;
}

function decodeBase64(value: string, maxBytes: number, label: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maxBytes)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label} must be no larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
    });
  return bytes;
}

async function logActivity(
  companyId: number,
  actorId: number,
  actorName: string,
  action: string,
  summary: string
) {
  const db = await database();
  await insertRecord(db, "bf_activity_logs", {
    companyId,
    actorId,
    actorName,
    action,
    entity: "document_format",
    entityId: companyId,
    summary,
    createdAt: new Date(),
  });
}

export const documentFormatRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const [company, format] = await Promise.all([
      collection(db, "bf_companies").findOne({ id: ctx.user.companyId }),
      collection(db, "bf_document_formats").findOne({
        companyId: ctx.user.companyId,
      }),
    ]);
    if (!company)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Workspace not found.",
      });
    const effectiveFormat = format ?? {
      letterheadKey: null,
      reservedTopMm: 38,
      reservedBottomMm: 24,
    };
    const logo = company.logoKey ? await storageGet(company.logoKey) : null;
    return {
      company: {
        id: company.id,
        name: company.name,
        email: company.email,
        currency: company.currency,
        address: company.address,
        phone: company.phone,
        gstNumber: company.gstNumber,
        logoKey: company.logoKey,
        logoUrl: logo?.url ?? null,
      },
      format: {
        letterheadKey: effectiveFormat.letterheadKey,
        letterheadUrl: effectiveFormat.letterheadKey
          ? (await storageGet(effectiveFormat.letterheadKey)).url
          : null,
        reservedTopMm: effectiveFormat.reservedTopMm,
        reservedBottomMm: effectiveFormat.reservedBottomMm,
      },
    };
  }),

  letterheadBytes: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const format = await collection(db, "bf_document_formats").findOne(
      { companyId: ctx.user.companyId },
      { projection: { letterheadKey: 1 } }
    );
    const key = format?.letterheadKey;
    if (!key) return { base64: null };
    const signedUrl = await storageGetSignedUrl(key);
    const response = await fetch(signedUrl, { cache: "no-store" });
    if (!response.ok)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The saved letterhead could not be downloaded from storage.",
      });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length > MAX_PDF_BYTES ||
      !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The saved letterhead is invalid or exceeds 8 MB.",
      });
    return { base64: bytes.toString("base64") };
  }),

  logoBytes: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const company = await collection(db, "bf_companies").findOne(
      { id: ctx.user.companyId },
      { projection: { logoKey: 1 } }
    );
    const key = company?.logoKey;
    if (!key) return { base64: null };
    const signedUrl = await storageGetSignedUrl(key);
    const response = await fetch(signedUrl, { cache: "no-store" });
    if (!response.ok)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The company logo could not be downloaded from storage.",
      });
    const bytes = Buffer.from(await response.arrayBuffer());
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (bytes.length > MAX_LOGO_BYTES || (!png && !jpeg))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The saved company logo is invalid or exceeds 4 MB.",
      });
    return { base64: bytes.toString("base64") };
  }),

  save: adminProcedure
    .input(
      z
        .object({
          reservedTopMm: z.number().int().min(0).max(120),
          reservedBottomMm: z.number().int().min(0).max(100),
          letterheadBase64: base64Field.optional(),
          removeLetterhead: z.boolean().default(false),
        })
        .refine(value => value.reservedTopMm + value.reservedBottomMm <= 160, {
          message: "Combined reserved areas cannot exceed 160 mm.",
        })
        .refine(value => !(value.letterheadBase64 && value.removeLetterhead), {
          message: "Upload and remove cannot be selected together.",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      let key: string | null | undefined;
      if (input.letterheadBase64) {
        const bytes = decodeBase64(
          input.letterheadBase64,
          MAX_PDF_BYTES,
          "PDF letterhead"
        );
        if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Upload a valid PDF letterhead.",
          });
        const stored = await storagePut(
          `billflow/${ctx.user.companyId}/letterhead.pdf`,
          bytes,
          "application/pdf"
        );
        key = stored.key;
      } else if (input.removeLetterhead) key = null;
      const formats = collection(db, "bf_document_formats");
      const current = await formats.findOne({ companyId: ctx.user.companyId });
      const letterheadKey =
        key === undefined ? (current?.letterheadKey ?? null) : key;
      const id = await nextId(db, "bf_document_formats");
      await formats.updateOne(
        { companyId: ctx.user.companyId },
        {
          $set: {
            letterheadKey,
            reservedTopMm: input.reservedTopMm,
            reservedBottomMm: input.reservedBottomMm,
            updatedAt: new Date(),
          },
          $setOnInsert: { id, companyId: ctx.user.companyId },
        },
        { upsert: true }
      );
      await logActivity(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "edited",
        "Updated the invoice and quotation letterhead format"
      );
      return { success: true, letterheadKey };
    }),

  uploadLogo: adminProcedure
    .input(z.object({ base64: base64Field }))
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const bytes = decodeBase64(input.base64, MAX_LOGO_BYTES, "Company logo");
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!png && !jpeg)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Company logo must be a PNG or JPEG image.",
        });
      const stored = await storagePut(
        `billflow/${ctx.user.companyId}/logo.${png ? "png" : "jpg"}`,
        bytes,
        png ? "image/png" : "image/jpeg"
      );
      await collection(db, "bf_companies").updateOne(
        { id: ctx.user.companyId },
        { $set: { logoKey: stored.key } }
      );
      await logActivity(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "edited",
        "Updated the company logo"
      );
      return {
        success: true,
        logoKey: stored.key,
        logoUrl: (await storageGet(stored.key)).url,
      };
    }),
});
