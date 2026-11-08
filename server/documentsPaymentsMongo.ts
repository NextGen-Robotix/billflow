import { TRPCError } from "@trpc/server";
import { z } from "zod";
import nodemailer from "nodemailer";
import {
  collection,
  getDb,
  insertRecord,
  insertRecords,
  nextId,
  withTransaction,
} from "./mongoDb";
import {
  accountantProcedure,
  adminProcedure,
  protectedProcedure,
  router,
} from "./_core/trpc";
import { emailLayout, escapeHtml } from "./emailTemplates";

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
const itemSchema = z.object({
  name: z.string().trim().min(1).max(240),
  quantity: z.number().positive().max(1000000),
  rate: z.number().min(0).max(100000000),
  taxPercent: z.number().min(0).max(100),
});
const docInput = z.object({
  customerId: z.number().int().positive(),
  kind: z.enum(["invoice", "quotation"]),
  issueDate: z.string(),
  dueDate: z.string().optional(),
  notes: z.string().max(6000).optional(),
  discount: z.number().min(0).max(100000000).default(0),
  discountMode: z.enum(["amount", "percent"]).default("amount"),
  items: z.array(itemSchema).min(1).max(80),
});
const dayString = (date: Date) => date.toISOString().slice(0, 10);
const amount = (n: unknown) => Number(n ?? 0);
function calculate(
  items: z.infer<typeof itemSchema>[],
  discount: number,
  mode: "amount" | "percent"
) {
  const subtotal = items.reduce((s, x) => s + x.quantity * x.rate, 0);
  const taxTotal = items.reduce(
    (s, x) => s + x.quantity * x.rate * (x.taxPercent / 100),
    0
  );
  const discountAmount = Math.min(
    subtotal + taxTotal,
    mode === "percent" ? ((subtotal + taxTotal) * discount) / 100 : discount
  );
  return {
    subtotal: +subtotal.toFixed(2),
    taxTotal: +taxTotal.toFixed(2),
    discountAmount: +discountAmount.toFixed(2),
    total: +Math.max(0, subtotal + taxTotal - discountAmount).toFixed(2),
  };
}
function statusFromPayments(
  total: number,
  paid: number,
  dueDate?: string | null
): "sent" | "partially_paid" | "paid" | "overdue" {
  if (paid >= total && total > 0) return "paid";
  if (dueDate && dueDate < dayString(new Date())) return "overdue";
  if (paid > 0) return "partially_paid";
  return "sent";
}
async function logActivity(
  db: Awaited<ReturnType<typeof getDb>>,
  companyId: number,
  actorId: number,
  actorName: string,
  action: string,
  entity: string,
  entityId: number | null,
  summary: string,
  session?: import("mongodb").ClientSession
) {
  await insertRecord(
    db,
    "bf_activity_logs",
    {
      companyId,
      actorId,
      actorName,
      action,
      entity,
      entityId,
      summary,
      createdAt: new Date(),
    },
    session
  );
}
async function deliver(to: string, subject: string, html: string) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  const port = Number(process.env.SMTP_PORT || "587");
  if (!host || !user || !pass || !from || !Number.isInteger(port))
    return {
      sent: false,
      reason:
        "Email delivery is not configured. Add SMTP host, port, username, password, and sender address in project secrets.",
    };
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
    });
    await transporter.sendMail({ from, to, subject, html });
    return {
      sent: true as const,
      reason: "Message accepted by the mail server.",
    };
  } catch (error) {
    return {
      sent: false as const,
      reason:
        error instanceof Error
          ? error.message.slice(0, 420)
          : "Mail server delivery failed.",
    };
  }
}
async function logNotice(
  companyId: number,
  documentId: number | null,
  recipient: string,
  kind: "invoice" | "reminder",
  result: { sent: boolean; reason: string }
) {
  const db = await getDb();
  await insertRecord(db, "bf_notification_logs", {
    companyId,
    documentId,
    recipient,
    kind,
    status: result.sent
      ? "sent"
      : result.reason.startsWith("Email delivery is not configured")
        ? "blocked"
        : "failed",
    message: result.reason,
    createdAt: new Date(),
  });
}

export const documentsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          kind: z.enum(["invoice", "quotation"]).optional(),
          status: z.string().optional(),
          customerId: z.number().optional(),
          from: dateField.optional(),
          to: dateField.optional(),
          search: z.string().optional(),
        })
        .refine(input => !input.from || !input.to || input.from <= input.to, {
          message: "Start date must be on or before end date.",
          path: ["to"],
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const query: Record<string, unknown> = { companyId: ctx.user.companyId };
      if (input?.kind) query.kind = input.kind;
      if (input?.customerId) query.customerId = input.customerId;
      if (input?.from || input?.to)
        query.issueDate = {
          ...(input.from ? { $gte: input.from } : {}),
          ...(input.to ? { $lte: input.to } : {}),
        };
      const docs = await collection(db, "bf_documents")
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      const custIds = [...new Set(docs.map(d => d.customerId))];
      const customerRows = custIds.length
        ? await collection(db, "bf_customers")
            .find({ companyId: ctx.user.companyId, id: { $in: custIds } })
            .toArray()
        : [];
      const byCustomer = new Map(customerRows.map(c => [c.id, c]));
      const needle = input?.search?.toLowerCase();
      return docs
        .map(d => {
          const customer = byCustomer.get(d.customerId) ?? null;
          const overdue =
            d.kind === "invoice" &&
            !["draft", "on_hold", "paid"].includes(d.status) &&
            !!d.dueDate &&
            d.dueDate < dayString(new Date()) &&
            amount(d.total) > amount(d.amountPaid);
          return {
            document: { ...d, status: overdue ? "overdue" : d.status },
            customer,
          };
        })
        .filter(
          r =>
            !input?.status ||
            input.status === "all" ||
            r.document.status === input.status
        )
        .filter(
          r =>
            !needle ||
            r.document.number.toLowerCase().includes(needle) ||
            r.customer?.name.toLowerCase().includes(needle)
        );
    }),
  detail: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const d = await collection(db, "bf_documents").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND" });
      const customer = await collection(db, "bf_customers").findOne({
        id: d.customerId,
        companyId: ctx.user.companyId,
      });
      const items = await collection(db, "bf_document_items")
        .find({ documentId: input.id })
        .toArray();
      return { document: d, customer: customer ?? null, items };
    }),
  save: accountantProcedure
    .input(docInput.extend({ id: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const customer = await collection(db, "bf_customers").findOne({
        id: input.customerId,
        companyId: ctx.user.companyId,
      });
      if (!customer)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Choose a customer in your workspace.",
        });
      const totals = calculate(input.items, input.discount, input.discountMode);
      const issueDate = input.issueDate || dayString(new Date());
      const now = new Date();
      const id = await withTransaction(async (txdb, session) => {
        let savedId = input.id;
        const docs = collection(txdb, "bf_documents"),
          items = collection(txdb, "bf_document_items");
        if (savedId) {
          const existing = await docs.findOne(
            { id: savedId, companyId: ctx.user.companyId },
            { session }
          );
          if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
          if (existing.kind !== input.kind)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Document type cannot be changed.",
            });
          if (amount(existing.amountPaid) > totals.total + 0.01)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "The revised total cannot be less than payments already received.",
            });
          await docs.updateOne(
            { id: savedId, companyId: ctx.user.companyId },
            {
              $set: {
                customerId: input.customerId,
                issueDate,
                dueDate: input.dueDate || null,
                notes: input.notes || null,
                discount: String(totals.discountAmount),
                discountMode: input.discountMode,
                subtotal: String(totals.subtotal),
                taxTotal: String(totals.taxTotal),
                total: String(totals.total),
                updatedAt: now,
              },
            },
            { session }
          );
          await items.deleteMany({ documentId: savedId }, { session });
          await insertRecords(
            txdb,
            "bf_document_items",
            input.items.map(item => ({
              documentId: savedId!,
              name: item.name,
              quantity: String(item.quantity),
              rate: String(item.rate),
              taxPercent: String(item.taxPercent),
            })),
            session
          );
        } else {
          const company = collection(txdb, "bf_companies");
          if (!(await company.findOne({ id: ctx.user.companyId }, { session })))
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Company not found.",
            });
          const year = Number(issueDate.slice(0, 4));
          const counters = collection(txdb, "bf_document_counters");
          const counterId = await nextId(txdb, "bf_document_counters");
          const counter = await counters.findOneAndUpdate(
            { companyId: ctx.user.companyId, year, kind: input.kind },
            {
              $inc: { counter: 1 },
              $setOnInsert: {
                id: counterId,
                companyId: ctx.user.companyId,
                year,
                kind: input.kind,
              },
            },
            { upsert: true, returnDocument: "after", session }
          );
          if (!counter)
            throw new Error("Could not allocate a document number.");
          const nextCounter = counter.counter;
          const prefix = input.kind === "invoice" ? "INV" : "QUO";
          const number = `${prefix}-${year}-${String(nextCounter).padStart(3, "0")}`;
          const doc = await insertRecord(
            txdb,
            "bf_documents",
            {
              companyId: ctx.user.companyId,
              customerId: input.customerId,
              kind: input.kind,
              number,
              status: "draft",
              issueDate,
              dueDate: input.dueDate || null,
              notes: input.notes || null,
              discount: String(totals.discountAmount),
              discountMode: input.discountMode,
              subtotal: String(totals.subtotal),
              taxTotal: String(totals.taxTotal),
              total: String(totals.total),
              amountPaid: "0",
              createdBy: ctx.user.id,
              convertedFrom: null,
              createdAt: now,
              updatedAt: now,
            },
            session
          );
          savedId = doc.id;
          await insertRecords(
            txdb,
            "bf_document_items",
            input.items.map(item => ({
              documentId: doc.id,
              name: item.name,
              quantity: String(item.quantity),
              rate: String(item.rate),
              taxPercent: String(item.taxPercent),
            })),
            session
          );
        }
        await logActivity(
          txdb,
          ctx.user.companyId,
          ctx.user.id,
          ctx.user.name,
          input.id ? "edited" : "created",
          input.kind,
          savedId!,
          `${input.id ? "Updated" : "Created"} ${input.kind} for ${input.items.length} line item(s)`,
          session
        );
        return savedId!;
      });
      return { id, totals };
    }),
  convert: accountantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const result = await withTransaction(async (txdb, session) => {
        const company = collection(txdb, "bf_companies");
        if (!(await company.findOne({ id: ctx.user.companyId }, { session })))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Company not found.",
          });
        const docs = collection(txdb, "bf_documents");
        const quote = await docs.findOne(
          { id: input.id, companyId: ctx.user.companyId, kind: "quotation" },
          { session }
        );
        if (!quote)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Quotation not found.",
          });
        const prior = await docs.findOne(
          { companyId: ctx.user.companyId, convertedFrom: quote.id },
          { projection: { id: 1, number: 1 }, session }
        );
        if (prior)
          return {
            id: prior.id,
            number: prior.number,
            alreadyConverted: true as const,
          };
        if (quote.status === "accepted")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "This quotation has already been accepted.",
          });
        const year = new Date().getFullYear();
        const counters = collection(txdb, "bf_document_counters");
        const counterId = await nextId(txdb, "bf_document_counters");
        const counter = await counters.findOneAndUpdate(
          { companyId: ctx.user.companyId, year, kind: "invoice" },
          {
            $inc: { counter: 1 },
            $setOnInsert: {
              id: counterId,
              companyId: ctx.user.companyId,
              year,
              kind: "invoice",
            },
          },
          { upsert: true, returnDocument: "after", session }
        );
        if (!counter) throw new Error("Could not allocate an invoice number.");
        const nextCounter = counter.counter;
        const number = `INV-${year}-${String(nextCounter).padStart(3, "0")}`;
        const now = new Date();
        const invoice = await insertRecord(
          txdb,
          "bf_documents",
          {
            companyId: ctx.user.companyId,
            customerId: quote.customerId,
            kind: "invoice",
            number,
            status: "draft",
            issueDate: dayString(now),
            dueDate: quote.dueDate,
            subtotal: quote.subtotal,
            taxTotal: quote.taxTotal,
            discount: quote.discount,
            discountMode: quote.discountMode,
            total: quote.total,
            amountPaid: "0",
            notes: quote.notes,
            createdBy: ctx.user.id,
            convertedFrom: quote.id,
            createdAt: now,
            updatedAt: now,
          },
          session
        );
        const oldItems = await collection(txdb, "bf_document_items")
          .find({ documentId: quote.id }, { session })
          .toArray();
        if (oldItems.length)
          await insertRecords(
            txdb,
            "bf_document_items",
            oldItems.map(i => ({
              documentId: invoice.id,
              name: i.name,
              quantity: i.quantity,
              rate: i.rate,
              taxPercent: i.taxPercent,
            })),
            session
          );
        await docs.updateOne(
          { id: quote.id, companyId: ctx.user.companyId },
          { $set: { status: "accepted", updatedAt: now } },
          { session }
        );
        await logActivity(
          txdb,
          ctx.user.companyId,
          ctx.user.id,
          ctx.user.name,
          "converted",
          "quotation",
          input.id,
          `Converted ${quote.number} to ${number}`,
          session
        );
        return {
          id: invoice.id,
          number,
          alreadyConverted: false as const,
          quoteNumber: quote.number,
        };
      });
      return { id: result.id, number: result.number };
    }),
  setStatus: accountantProcedure
    .input(
      z.object({
        id: z.number().positive(),
        status: z.enum(["draft", "sent", "on_hold", "accepted"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const doc = await collection(db, "bf_documents").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      await collection(db, "bf_documents").updateOne(
        { id: input.id, companyId: ctx.user.companyId },
        { $set: { status: input.status, updatedAt: new Date() } }
      );
      await logActivity(
        db,
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "edited",
        doc.kind,
        input.id,
        `Changed ${doc.number} to ${input.status.replaceAll("_", " ")}`
      );
      return { success: true };
    }),
  remove: adminProcedure
    .input(z.object({ id: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const doc = await collection(db, "bf_documents").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      await withTransaction(async (txdb, session) => {
        const owned = await collection(txdb, "bf_documents").findOne(
          { id: input.id, companyId: ctx.user.companyId },
          { session }
        );
        if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
        if (amount(owned.amountPaid) > 0)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Invoices with recorded payments cannot be deleted.",
          });
        await collection(txdb, "bf_payments").deleteMany(
          { companyId: ctx.user.companyId, documentId: input.id },
          { session }
        );
        await collection(txdb, "bf_document_items").deleteMany(
          { documentId: input.id },
          { session }
        );
        await collection(txdb, "bf_documents").deleteOne(
          { id: input.id, companyId: ctx.user.companyId },
          { session }
        );
        await logActivity(
          txdb,
          ctx.user.companyId,
          ctx.user.id,
          ctx.user.name,
          "deleted",
          owned.kind,
          input.id,
          `Deleted ${owned.number}`,
          session
        );
      });
      return { success: true };
    }),
  send: accountantProcedure
    .input(
      z.object({
        id: z.number().positive(),
        kind: z.enum(["invoice", "reminder"]).default("invoice"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const doc = await collection(db, "bf_documents").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const customer = await collection(db, "bf_customers").findOne({
        id: doc.customerId,
        companyId: ctx.user.companyId,
      });
      const company = await collection(db, "bf_companies").findOne({
        id: doc.companyId,
      });
      if (!customer || !company) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.kind === "reminder" && doc.kind !== "invoice")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payment reminders can only be sent for invoices.",
        });
      const recipient = customer.email;
      if (!recipient)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add an email address to this customer first.",
        });
      const outstanding = Math.max(
        0,
        amount(doc.total) - amount(doc.amountPaid)
      );
      const subject =
        input.kind === "invoice"
          ? `${doc.kind === "quotation" ? "Quotation" : "Invoice"} ${doc.number} from ${company.name}`
          : `Payment reminder: ${doc.number}`;
      const isReminder = input.kind === "reminder";
      const documentLabel = doc.kind === "quotation" ? "quotation" : "invoice";
      const html = emailLayout({
        companyName: company.name,
        title: isReminder
          ? "Payment reminder"
          : `${doc.kind === "quotation" ? "Quotation" : "Invoice"} ${doc.number}`,
        preheader: isReminder
          ? `Payment reminder for invoice ${doc.number}.`
          : `Your ${documentLabel} ${doc.number} from ${company.name}.`,
        content: `<p>Hello ${escapeHtml(customer.name)},</p><p>${isReminder ? `This is a reminder that <strong>${escapeHtml(company.currency)} ${outstanding.toFixed(2)}</strong> remains due for invoice <strong>${escapeHtml(doc.number)}</strong>.` : `Please find your ${documentLabel} <strong>${escapeHtml(doc.number)}</strong> for <strong>${escapeHtml(company.currency)} ${amount(doc.total).toFixed(2)}</strong>.`}</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;width:100%;border:1px solid #e2e8f0;border-radius:6px"><tr><td style="padding:12px;color:#64748b">${isReminder ? "Amount due" : "Total amount"}</td><td align="right" style="padding:12px;font-weight:700">${escapeHtml(company.currency)} ${(isReminder ? outstanding : amount(doc.total)).toFixed(2)}</td></tr><tr><td style="padding:12px;color:#64748b;border-top:1px solid #e2e8f0">Due date</td><td align="right" style="padding:12px;border-top:1px solid #e2e8f0">${escapeHtml(doc.dueDate ?? "Not specified")}</td></tr></table>${doc.notes ? `<p><strong>Notes:</strong><br>${escapeHtml(doc.notes).replace(/\n/g, "<br>")}</p>` : ""}<p>${isReminder ? "Please arrange payment at your earliest convenience. If you have already paid, please disregard this message." : "Thank you for your business."}</p><p>Regards,<br>${escapeHtml(company.name)}</p>`,
      });
      const result = await deliver(recipient, subject, html);
      await logNotice(
        ctx.user.companyId,
        doc.id,
        recipient,
        input.kind,
        result
      );
      if (result.sent && doc.status === "draft")
        await collection(db, "bf_documents").updateOne(
          { id: doc.id, companyId: ctx.user.companyId },
          { $set: { status: "sent", updatedAt: new Date() } }
        );
      if (!result.sent)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.reason,
        });
      await logActivity(
        db,
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "sent",
        input.kind,
        doc.id,
        `Sent ${input.kind} ${doc.number} to ${recipient}`
      );
      return { success: true };
    }),
});

export const paymentsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({ from: dateField.optional(), to: dateField.optional() })
        .refine(input => !input.from || !input.to || input.from <= input.to, {
          message: "Start date must be on or before end date.",
          path: ["to"],
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const q: Record<string, unknown> = { companyId: ctx.user.companyId };
      if (input?.from || input?.to)
        q.paymentDate = {
          ...(input.from ? { $gte: input.from } : {}),
          ...(input.to ? { $lte: input.to } : {}),
        };
      const paymentRows = await collection(db, "bf_payments")
        .find(q)
        .sort({ paymentDate: -1 })
        .toArray();
      const documentIds = [...new Set(paymentRows.map(p => p.documentId))];
      const docs = documentIds.length
        ? await collection(db, "bf_documents")
            .find({ companyId: ctx.user.companyId, id: { $in: documentIds } })
            .toArray()
        : [];
      const byDoc = new Map(docs.map(d => [d.id, d]));
      const customerIds = [...new Set(docs.map(d => d.customerId))];
      const customers = customerIds.length
        ? await collection(db, "bf_customers")
            .find({ companyId: ctx.user.companyId, id: { $in: customerIds } })
            .toArray()
        : [];
      const byCustomer = new Map(customers.map(c => [c.id, c]));
      return paymentRows.map(payment => {
        const document = byDoc.get(payment.documentId) ?? null;
        return {
          payment,
          document,
          customer: document
            ? (byCustomer.get(document.customerId) ?? null)
            : null,
        };
      });
    }),
  add: accountantProcedure
    .input(
      z.object({
        documentId: z.number().positive(),
        amount: z.number().positive(),
        paymentDate: z.string(),
        mode: z.enum([
          "bank_transfer",
          "upi",
          "cash",
          "card",
          "cheque",
          "other",
        ]),
        reference: z.string().max(160).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const result = await withTransaction(async (txdb, session) => {
        const docs = collection(txdb, "bf_documents");
        const doc = await docs.findOne(
          {
            id: input.documentId,
            companyId: ctx.user.companyId,
            kind: "invoice",
          },
          { session }
        );
        if (!doc)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invoice not found.",
          });
        const paid = amount(doc.amountPaid) + input.amount;
        if (paid > amount(doc.total) + 0.01)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment is more than the outstanding balance.",
          });
        await insertRecord(
          txdb,
          "bf_payments",
          {
            companyId: ctx.user.companyId,
            documentId: doc.id,
            amount: String(input.amount.toFixed(2)),
            paymentDate: input.paymentDate,
            mode: input.mode,
            reference: input.reference || null,
            createdBy: ctx.user.id,
            createdAt: new Date(),
          },
          session
        );
        const status = statusFromPayments(amount(doc.total), paid, doc.dueDate);
        await docs.updateOne(
          { id: doc.id, companyId: ctx.user.companyId },
          {
            $set: {
              amountPaid: String(paid.toFixed(2)),
              status,
              updatedAt: new Date(),
            },
          },
          { session }
        );
        await logActivity(
          txdb,
          ctx.user.companyId,
          ctx.user.id,
          ctx.user.name,
          "created",
          "payment",
          input.documentId,
          `Recorded ${input.amount.toFixed(2)} ${input.mode.replaceAll("_", " ")} for ${doc.number}`,
          session
        );
        return { paid };
      });
      return { success: true, amountPaid: result.paid };
    }),
});
