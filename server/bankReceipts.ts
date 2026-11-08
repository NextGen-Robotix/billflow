import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BANK_METHODS, BANK_PURPOSES } from "../shared/bankOptions";
import { calculateBankLedger } from "../shared/bankLedger";
import type { ActivityLog } from "../shared/models";
import { collection, getDb, insertRecord, withTransaction } from "./mongoDb";
import {
  accountantProcedure,
  adminProcedure,
  protectedProcedure,
  router,
} from "./_core/trpc";

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid date.");

const periodInput = z
  .object({ from: dateField, to: dateField })
  .refine(value => value.from <= value.to, {
    message: "The period start must be on or before its end.",
    path: ["to"],
  });

async function database() {
  try {
    return await getDb();
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "BillFlow database is unavailable.",
    });
  }
}

const addInput = z
  .object({
    transactionDate: dateField,
    direction: z.enum(["credit", "debit"]),
    amount: z
      .number()
      .positive()
      .max(999_999_999_999.99)
      .refine(
        value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
        "Use no more than two decimal places."
      ),
    method: z.enum(BANK_METHODS),
    methodOther: z.string().trim().max(160).optional(),
    purposeCategory: z.enum(BANK_PURPOSES),
    purposeOther: z.string().trim().max(240).optional(),
    counterparty: z.string().trim().max(180).optional(),
    reference: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .superRefine((value, context) => {
    if (value.method === "Other" && !value.methodOther) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["methodOther"],
        message: "Enter the exact payment method.",
      });
    }
    if (value.purposeCategory === "Other" && !value.purposeOther) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purposeOther"],
        message: "Enter the exact transaction purpose.",
      });
    }
  });

export const bankReceiptsRouter = router({
  list: protectedProcedure.input(periodInput).query(async ({ ctx, input }) => {
    const db = await database();
    const [company, sourceRows] = await Promise.all([
      collection(db, "bf_companies").findOne(
        { id: ctx.user.companyId },
        { projection: { bankOpeningBalance: 1, bankOpeningDate: 1, _id: 0 } }
      ),
      collection(db, "bf_bank_transactions")
        .find({ companyId: ctx.user.companyId })
        .sort({ transactionDate: 1, id: 1 })
        .toArray(),
    ]);
    if (!company)
      throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });

    const balances = calculateBankLedger(
      company.bankOpeningBalance,
      company.bankOpeningDate,
      sourceRows,
      input.from,
      input.to
    );

    return {
      openingBalance: balances.openingBalance,
      openingDate: company.bankOpeningDate,
      periodOpeningBalance: balances.periodOpeningBalance,
      periodClosingBalance: balances.periodClosingBalance,
      currentBalance: balances.currentBalance,
      credits: balances.credits,
      debits: balances.debits,
      transactions: balances.transactions,
    };
  }),

  add: accountantProcedure.input(addInput).mutation(async ({ ctx, input }) => {
    const db = await database();
    let transactionId = 0;
    await withTransaction(async (txDb, session) => {
      const company = await collection(txDb, "bf_companies").findOne(
        { id: ctx.user.companyId },
        { projection: { bankOpeningDate: 1, currency: 1, _id: 0 }, session }
      );
      if (!company)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Company not found.",
        });
      if (
        company.bankOpeningDate &&
        input.transactionDate < company.bankOpeningDate
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This transaction date is before the opening balance date (${company.bankOpeningDate}).`,
        });
      }
      const created = await insertRecord(
        db,
        "bf_bank_transactions",
        {
          companyId: ctx.user.companyId,
          transactionDate: input.transactionDate,
          direction: input.direction,
          amount: input.amount.toFixed(2),
          method: input.method,
          methodOther:
            input.method === "Other" ? input.methodOther!.trim() : null,
          purposeCategory: input.purposeCategory,
          purposeOther:
            input.purposeCategory === "Other"
              ? input.purposeOther!.trim()
              : null,
          counterparty: input.counterparty?.trim() || null,
          reference: input.reference?.trim() || null,
          notes: input.notes?.trim() || null,
          createdBy: ctx.user.id,
          createdAt: new Date(),
        },
        session
      );
      transactionId = created.id;
      const method =
        input.method === "Other" ? input.methodOther : input.method;
      const purpose =
        input.purposeCategory === "Other"
          ? input.purposeOther
          : input.purposeCategory;
      await insertRecord(
        db,
        "bf_activity_logs",
        {
          companyId: ctx.user.companyId,
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? "",
          action: "created",
          entity: "bank_transaction",
          entityId: created.id,
          summary:
            `Recorded ${input.direction} ${company.currency} ${input.amount.toFixed(2)} · ${purpose} · ${method}`.slice(
              0,
              300
            ),
          createdAt: new Date(),
        } satisfies Omit<ActivityLog, "id">,
        session
      );
    });
    return { success: true, id: transactionId };
  }),

  setOpeningBalance: adminProcedure
    .input(
      z.object({
        amount: z
          .number()
          .min(-999_999_999_999.99)
          .max(999_999_999_999.99)
          .refine(
            value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
            "Use no more than two decimal places."
          ),
        date: dateField,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      await withTransaction(async (txDb, session) => {
        const company = await collection(txDb, "bf_companies").findOne(
          { id: ctx.user.companyId },
          { projection: { currency: 1, _id: 0 }, session }
        );
        if (!company)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Company not found.",
          });
        const firstTransaction = await collection(txDb, "bf_bank_transactions")
          .find(
            { companyId: ctx.user.companyId },
            { projection: { transactionDate: 1, id: 1, _id: 0 }, session }
          )
          .sort({ transactionDate: 1, id: 1 })
          .limit(1)
          .next();
        if (firstTransaction && input.date > firstTransaction.transactionDate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `The opening date must be on or before the earliest recorded transaction (${firstTransaction.transactionDate}).`,
          });
        }
        await collection(txDb, "bf_companies").updateOne(
          { id: ctx.user.companyId },
          {
            $set: {
              bankOpeningBalance: input.amount.toFixed(2),
              bankOpeningDate: input.date,
            },
          },
          { session }
        );
        await insertRecord(
          db,
          "bf_activity_logs",
          {
            companyId: ctx.user.companyId,
            actorId: ctx.user.id,
            actorName: ctx.user.name ?? "",
            action: "updated",
            entity: "bank_opening_balance",
            entityId: null,
            summary: `Set current-account opening balance to ${company.currency} ${input.amount.toFixed(2)} as of ${input.date}.`,
            createdAt: new Date(),
          },
          session
        );
      });
      return { success: true };
    }),
});
