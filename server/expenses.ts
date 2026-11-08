import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { collection, getDb, insertRecord, withTransaction } from "./mongoDb";
import { accountantProcedure, protectedProcedure, router } from "./_core/trpc";

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
const builtInHeads = [
  "Rent",
  "Salary",
  "Software",
  "Travel",
  "Misc",
  "Other",
] as const;
const builtInHeadSet = new Set<string>(builtInHeads);
const expenseInput = z
  .object({
    id: z.number().int().positive().optional(),
    date: dateField,
    amount: z.number().positive().max(1000000000),
    purpose: z.string().trim().min(1).max(500),
    kind: z.enum(["invoice", "other"]),
    invoiceId: z.number().int().positive().optional(),
    category: z.string().trim().min(1).max(80).optional(),
    paidBy: z.string().trim().min(1).max(180),
    reimbursementStatus: z.enum(["paid", "due"]).default("due"),
    reimbursementDueDate: dateField.nullable().optional(),
    reimbursedDate: dateField.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.reimbursementStatus === "due" && !value.reimbursementDueDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reimbursementDueDate"],
        message: "Set a reimbursement due date or mark this expense as Paid.",
      });
    }
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

async function audit(
  companyId: number,
  actorId: number,
  actorName: string,
  action: string,
  id: number,
  purpose: string,
  entity = "expense"
) {
  const db = await database();
  await insertRecord(db, "bf_activity_logs", {
    companyId,
    actorId,
    actorName,
    action,
    entity,
    entityId: id,
    summary: purpose.slice(0, 280),
    createdAt: new Date(),
  });
}

export const expensesRouter = router({
  heads: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const [heads, expenses] = await Promise.all([
      collection(db, "bf_expense_heads")
        .find({ companyId: ctx.user.companyId })
        .toArray(),
      collection(db, "bf_expenses")
        .find({
          companyId: ctx.user.companyId,
          kind: "other",
        })
        .toArray(),
    ]);
    const usageByName = new Map<string, number>();
    for (const expense of expenses) {
      if (expense.category)
        usageByName.set(
          expense.category,
          (usageByName.get(expense.category) ?? 0) + 1
        );
    }
    return heads
      .map(head => ({
        id: head.id,
        name: head.name,
        usage: usageByName.get(head.name) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  addHead: accountantProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const name = input.name.trim();
      if (builtInHeads.some(head => head.toLowerCase() === name.toLowerCase()))
        throw new TRPCError({
          code: "CONFLICT",
          message: "That name is already a built-in expense head.",
        });
      const existing = await collection(db, "bf_expense_heads").findOne({
        companyId: ctx.user.companyId,
        name,
      });
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: "An expense head with that name already exists.",
        });
      const created = await insertRecord(db, "bf_expense_heads", {
        companyId: ctx.user.companyId,
        name,
        createdBy: ctx.user.id,
        createdAt: new Date(),
      });
      await audit(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "created",
        created.id,
        `Added expense head: ${name}`,
        "expense_head"
      );
      return { id: created.id, name };
    }),

  updateHead: accountantProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).max(80),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const name = input.name.trim();
      if (builtInHeads.some(head => head.toLowerCase() === name.toLowerCase()))
        throw new TRPCError({
          code: "CONFLICT",
          message: "That name is already a built-in expense head.",
        });
      const owned = await collection(db, "bf_expense_heads").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!owned)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense head not found in this workspace.",
        });
      const duplicate = await collection(db, "bf_expense_heads").findOne({
        companyId: ctx.user.companyId,
        name,
      });
      if (duplicate && duplicate.id !== input.id)
        throw new TRPCError({
          code: "CONFLICT",
          message: "An expense head with that name already exists.",
        });
      await withTransaction(async (txDb, session) => {
        await collection(txDb, "bf_expense_heads").updateOne(
          { id: input.id, companyId: ctx.user.companyId },
          { $set: { name } },
          { session }
        );
        await collection(txDb, "bf_expenses").updateMany(
          {
            companyId: ctx.user.companyId,
            kind: "other",
            category: owned.name,
          },
          { $set: { category: name, updatedAt: new Date() } },
          { session }
        );
        await insertRecord(
          txDb,
          "bf_activity_logs",
          {
            companyId: ctx.user.companyId,
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            action: "edited",
            entity: "expense_head",
            entityId: input.id,
            summary: `Renamed expense head from ${owned.name} to ${name}`.slice(
              0,
              280
            ),
            createdAt: new Date(),
          },
          session
        );
      });
      return { id: input.id, name };
    }),

  removeHead: accountantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const owned = await collection(db, "bf_expense_heads").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!owned)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense head not found in this workspace.",
        });
      const used = await collection(db, "bf_expenses").findOne({
        companyId: ctx.user.companyId,
        kind: "other",
        category: owned.name,
      });
      if (used)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This head is used by existing expenses. Rename it instead so historical category labels are retained.",
        });
      await collection(db, "bf_expense_heads").deleteOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      await audit(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "deleted",
        input.id,
        `Deleted unused expense head: ${owned.name}`,
        "expense_head"
      );
      return { success: true };
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          kind: z.enum(["invoice", "other", "all"]).optional(),
          dateFrom: dateField.optional(),
          dateTo: dateField.optional(),
          paidBy: z.string().max(180).optional(),
          search: z.string().max(120).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await database();
      const query: Record<string, unknown> = { companyId: ctx.user.companyId };
      if (input?.kind && input.kind !== "all") query.kind = input.kind;
      const date: Record<string, string> = {};
      if (input?.dateFrom) date.$gte = input.dateFrom;
      if (input?.dateTo) date.$lte = input.dateTo;
      if (Object.keys(date).length) query.date = date;
      if (input?.paidBy) query.paidBy = input.paidBy;
      const [expenseRows, payerRows] = await Promise.all([
        collection(db, "bf_expenses")
          .find(query)
          .sort({ date: -1, id: -1 })
          .toArray(),
        collection(db, "bf_expenses").distinct("paidBy", {
          companyId: ctx.user.companyId,
        }),
      ]);
      const invoiceIds = [
        ...new Set(
          expenseRows
            .map(row => row.invoiceId)
            .filter((id): id is number => id !== null)
        ),
      ];
      const invoices = invoiceIds.length
        ? await collection(db, "bf_documents")
            .find({ companyId: ctx.user.companyId, id: { $in: invoiceIds } })
            .toArray()
        : [];
      const customerIds = [
        ...new Set(invoices.map(invoice => invoice.customerId)),
      ];
      const customers = customerIds.length
        ? await collection(db, "bf_customers")
            .find({ companyId: ctx.user.companyId, id: { $in: customerIds } })
            .toArray()
        : [];
      const invoiceById = new Map(
        invoices.map(invoice => [invoice.id, invoice])
      );
      const customerById = new Map(
        customers.map(customer => [customer.id, customer])
      );
      const search = input?.search?.trim().toLowerCase();
      const entries = expenseRows
        .map(expense => {
          const invoice =
            expense.invoiceId === null
              ? null
              : (invoiceById.get(expense.invoiceId) ?? null);
          const customer = invoice
            ? (customerById.get(invoice.customerId) ?? null)
            : null;
          return { expense, invoice, customer };
        })
        .filter(
          row =>
            !search ||
            [
              row.expense.purpose,
              row.expense.paidBy,
              row.expense.category,
              row.invoice?.number,
              row.customer?.name,
            ].some(value => value?.toLowerCase().includes(search))
        );
      return {
        entries,
        payerNames: payerRows.sort((a, b) => a.localeCompare(b)),
      };
    }),

  save: accountantProcedure
    .input(expenseInput)
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      let invoiceId: number | null = null;
      let category: string | null = null;
      if (input.kind === "invoice") {
        if (!input.invoiceId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose the invoice this cost belongs to.",
          });
        const matching = await collection(db, "bf_documents").findOne({
          id: input.invoiceId,
          companyId: ctx.user.companyId,
          kind: "invoice",
        });
        if (!matching)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invoice not found in this workspace.",
          });
        invoiceId = input.invoiceId;
      } else {
        if (input.invoiceId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Other expenses cannot be linked to an invoice.",
          });
        category = input.category || "Other";
        if (!builtInHeadSet.has(category)) {
          const matching = await collection(db, "bf_expense_heads").findOne({
            companyId: ctx.user.companyId,
            name: category,
          });
          if (!matching)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Choose a built-in or saved expense head for this company.",
            });
        }
      }
      const values = {
        date: input.date,
        amount: input.amount.toFixed(2),
        purpose: input.purpose,
        kind: input.kind,
        invoiceId,
        category,
        paidBy: input.paidBy,
        reimbursementStatus: input.reimbursementStatus,
        reimbursementDueDate: input.reimbursementDueDate ?? null,
        reimbursedDate:
          input.reimbursementStatus === "paid"
            ? (input.reimbursedDate ?? null)
            : null,
      };
      let id = input.id;
      if (id) {
        const owns = await collection(db, "bf_expenses").findOne({
          id,
          companyId: ctx.user.companyId,
        });
        if (!owns)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Expense not found.",
          });
        await collection(db, "bf_expenses").updateOne(
          { id, companyId: ctx.user.companyId },
          { $set: { ...values, updatedAt: new Date() } }
        );
      } else {
        const created = await insertRecord(db, "bf_expenses", {
          ...values,
          companyId: ctx.user.companyId,
          createdBy: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        id = created.id;
      }
      await audit(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        input.id ? "edited" : "created",
        id!,
        `${input.id ? "Updated" : "Recorded"} ${input.kind === "invoice" ? "invoice" : "other"} expense: ${input.purpose} — ${input.reimbursementStatus === "paid" ? `Paid${input.reimbursedDate ? ` on ${input.reimbursedDate}` : ""}` : `Due ${input.reimbursementDueDate}`}`
      );
      return { id, success: true };
    }),

  remove: accountantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const row = await collection(db, "bf_expenses").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense not found.",
        });
      await collection(db, "bf_expenses").deleteOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      await audit(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "deleted",
        input.id,
        `Deleted expense: ${row.purpose}`
      );
      return { success: true };
    }),
});
