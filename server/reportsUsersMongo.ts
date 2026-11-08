import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import {
  collection,
  getDb,
  insertRecord,
  nextId,
  withTransaction,
} from "./mongoDb";
import { storageGet } from "./storage";
import type { AppUser } from "../shared/models";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { emailLayout, escapeHtml } from "./emailTemplates";

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(v => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "Enter a valid date.");
const logDateRangeSchema = z
  .object({ from: dateField.optional(), to: dateField.optional() })
  .refine(r => !r.from || !r.to || r.from <= r.to, {
    message: "Start date must be on or before end date.",
    path: ["to"],
  });
const emailSchema = z.string().email().max(320);
const amount = (n: unknown) => Number(n ?? 0);
const dayString = (d: Date) => d.toISOString().slice(0, 10);
async function dbOrThrow() {
  try {
    return await getDb();
  } catch (e) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        e instanceof Error ? e.message : "BillFlow database is unavailable",
    });
  }
}
async function companyFor(_userId: number, companyId: number) {
  const db = await dbOrThrow();
  const company = await collection(db, "bf_companies").findOne({
    id: companyId,
  });
  if (!company)
    throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
  return company;
}
function publicUser(u: AppUser) {
  return {
    id: u.id,
    companyId: u.companyId,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active === 1,
    createdAt: u.createdAt,
    lastSignedIn: u.lastSignedIn,
  };
}
async function logActivity(
  companyId: number,
  actorId: number | null,
  actorName: string,
  action: string,
  entity: string,
  entityId: number | null,
  summary: string,
  session?: import("mongodb").ClientSession
) {
  const db = await dbOrThrow();
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
  const host = process.env.SMTP_HOST,
    user = process.env.SMTP_USER,
    pass = process.env.SMTP_PASSWORD,
    from = process.env.SMTP_FROM,
    port = Number(process.env.SMTP_PORT || "587");
  if (!host || !user || !pass || !from || !Number.isInteger(port))
    return {
      sent: false,
      reason:
        "Email delivery is not configured. Add SMTP host, port, username, password, and sender address in project secrets.",
    };
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
    });
    await transport.sendMail({ from, to, subject, html });
    return {
      sent: true as const,
      reason: "Message accepted by the mail server.",
    };
  } catch (e) {
    return {
      sent: false as const,
      reason:
        e instanceof Error
          ? e.message.slice(0, 420)
          : "Mail server delivery failed.",
    };
  }
}
async function logNotice(
  companyId: number,
  documentId: number | null,
  recipient: string,
  kind: "invoice" | "reminder" | "daily_alert" | "invitation",
  result: { sent: boolean; reason: string },
  session?: import("mongodb").ClientSession
) {
  const db = await dbOrThrow();
  await insertRecord(
    db,
    "bf_notification_logs",
    {
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
    },
    session
  );
}
const inDateRange = (d: unknown, from?: string, to?: string) => {
  const s =
    d instanceof Date
      ? d.toISOString().slice(0, 10)
      : typeof d === "string"
        ? d.slice(0, 10)
        : "";
  return (!from || s >= from) && (!to || s <= to);
};

export const dashboardRouter = router({
  overview: protectedProcedure
    .input(
      z
        .object({
          from: dateField.optional(),
          to: dateField.optional(),
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional(),
          asOfDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine(v => {
              const d = new Date(`${v}T00:00:00Z`);
              return (
                !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v
              );
            })
            .optional(),
        })
        .refine(i => !i.from || !i.to || i.from <= i.to, {
          message: "Start date must be on or before end date.",
          path: ["to"],
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await dbOrThrow(),
        company = await companyFor(ctx.user.id, ctx.user.companyId);
      const today = input?.asOfDate ?? dayString(new Date()),
        to = input?.to ?? today,
        from = input?.from ?? `${input?.month ?? to.slice(0, 7)}-01`;
      if (from > to)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start date must be on or before end date.",
        });
      const [docs, payments, expenses, customers, acts, notices] =
        await Promise.all([
          collection(db, "bf_documents")
            .find({ companyId: ctx.user.companyId })
            .sort({ createdAt: -1 })
            .toArray(),
          collection(db, "bf_payments")
            .find({ companyId: ctx.user.companyId })
            .sort({ paymentDate: -1 })
            .toArray(),
          collection(db, "bf_expenses")
            .find({ companyId: ctx.user.companyId })
            .sort({ date: -1 })
            .toArray(),
          collection(db, "bf_customers")
            .find({ companyId: ctx.user.companyId })
            .toArray(),
          collection(db, "bf_activity_logs")
            .find({ companyId: ctx.user.companyId })
            .sort({ createdAt: -1 })
            .toArray(),
          collection(db, "bf_notification_logs")
            .find({ companyId: ctx.user.companyId })
            .sort({ createdAt: -1 })
            .toArray(),
        ]);
      const customersById = new Map(customers.map(c => [c.id, c]));
      const invoiceRows = docs
        .filter(d => d.kind === "invoice")
        .map(document => ({
          document,
          customer: customersById.get(document.customerId) ?? null,
        }));
      const period = invoiceRows.filter(r =>
          inDateRange(r.document.issueDate, from, to)
        ),
        pp = payments.filter(p => inDateRange(p.paymentDate, from, to)),
        pe = expenses.filter(e => inDateRange(e.date, from, to));
      const paidMap = new Map<number, number>();
      for (const p of payments)
        if (p.paymentDate <= to)
          paidMap.set(
            p.documentId,
            (paidMap.get(p.documentId) ?? 0) + amount(p.amount)
          );
      const paid = (d: (typeof invoiceRows)[number]["document"]) =>
        paidMap.has(d.id) ? paidMap.get(d.id)! : amount(d.amountPaid);
      const due = (d: (typeof invoiceRows)[number]["document"]) =>
        Math.max(0, amount(d.total) - paid(d));
      const collections = pp.reduce((s, p) => s + amount(p.amount), 0),
        invoiceExpenses = pe.reduce(
          (s, e) => s + (e.kind === "invoice" ? amount(e.amount) : 0),
          0
        ),
        otherExpenses = pe.reduce(
          (s, e) => s + (e.kind === "other" ? amount(e.amount) : 0),
          0
        ),
        netCash = collections - invoiceExpenses - otherExpenses;
      const pending = period
          .filter(r => !["draft", "on_hold"].includes(r.document.status))
          .reduce((s, r) => s + due(r.document), 0),
        onHold = period
          .filter(r => r.document.status === "on_hold")
          .reduce((s, r) => s + due(r.document), 0),
        overdue = period.filter(
          r =>
            r.document.dueDate &&
            r.document.dueDate < to &&
            due(r.document) > 0 &&
            !["draft", "on_hold"].includes(r.document.status)
        );
      const first = new Date(`${from.slice(0, 7)}-01T00:00:00Z`),
        last = new Date(`${to.slice(0, 7)}-01T00:00:00Z`),
        months: { key: string; name: string }[] = [];
      for (
        let d = first;
        d <= last;
        d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
      ) {
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        months.push({
          key,
          name: d.toLocaleString("en", {
            month: "short",
            year: "2-digit",
            timeZone: "UTC",
          }),
        });
      }
      const trend = months.map(m => {
        const received = pp.reduce(
            (s, p) =>
              s + (p.paymentDate.startsWith(m.key) ? amount(p.amount) : 0),
            0
          ),
          direct = pe.reduce(
            (s, e) =>
              s +
              (e.date.startsWith(m.key) && e.kind === "invoice"
                ? amount(e.amount)
                : 0),
            0
          ),
          operating = pe.reduce(
            (s, e) =>
              s +
              (e.date.startsWith(m.key) && e.kind === "other"
                ? amount(e.amount)
                : 0),
            0
          );
        return {
          month: m.name,
          amount: received,
          collections: received,
          invoiceExpenses: direct,
          otherExpenses: operating,
          netCash: received - direct - operating,
        };
      });
      const cohorts = months.map(m => {
        const issued = period.filter(
            r =>
              r.document.status !== "draft" &&
              r.document.issueDate.startsWith(m.key)
          ),
          billed = issued.reduce((s, r) => s + amount(r.document.total), 0),
          received = issued.reduce((s, r) => s + paid(r.document), 0);
        return {
          key: m.key,
          month: new Date(`${m.key}-01T00:00:00Z`).toLocaleString("en", {
            month: "short",
            year: "2-digit",
            timeZone: "UTC",
          }),
          billed,
          collectedToDate: received,
          outstanding: Math.max(0, billed - received),
        };
      });
      const top = new Map<
        number,
        { id: number; name: string; raised: number; received: number }
      >();
      for (const r of period) {
        if (!r.customer) continue;
        const s = top.get(r.customer.id) ?? {
          id: r.customer.id,
          name: r.customer.name,
          raised: 0,
          received: 0,
        };
        s.raised += amount(r.document.total);
        s.received += paid(r.document);
        top.set(r.customer.id, s);
      }
      const aging = { "0-30": 0, "30-60": 0, "60+": 0 };
      for (const r of overdue) {
        const days = Math.floor(
          (new Date(`${to}T00:00:00Z`).getTime() -
            new Date(`${r.document.dueDate}T00:00:00Z`).getTime()) /
            86400000
        );
        if (days <= 30) aging["0-30"] += due(r.document);
        else if (days <= 60) aging["30-60"] += due(r.document);
        else aging["60+"] += due(r.document);
      }
      const timestampIn = (v: Date) => inDateRange(v, from, to);
      return {
        company: {
          name: company.name,
          email: company.email,
          currency: company.currency,
          address: company.address,
          phone: company.phone,
          gstNumber: company.gstNumber,
          logoKey: company.logoKey,
        },
        metrics: {
          collected: collections,
          pending,
          onHold,
          overdueCount: overdue.length,
          revenueThisMonth: collections,
          invoiceExpenses,
          otherExpenses,
          netCash,
          expenseCount: pe.length,
          customerCount: customers.length,
          invoiceCount: period.length,
          totalInvoiced: period
            .filter(r => r.document.status !== "draft")
            .reduce((s, r) => s + amount(r.document.total), 0),
          totalCollected: collections,
          openInvoices: period.filter(
            r =>
              !["draft", "on_hold"].includes(r.document.status) &&
              due(r.document) > 0
          ).length,
        },
        trend,
        cohorts,
        topCustomers: [...top.values()]
          .sort((a, b) => b.received - a.received)
          .slice(0, 5),
        aging,
        recent: docs
          .filter(d => inDateRange(d.issueDate, from, to))
          .slice(0, 6)
          .map(document => ({
            document,
            customer: customersById.get(document.customerId) ?? null,
          })),
        activity: acts.filter(a => timestampIn(a.createdAt)).slice(0, 8),
        notices: notices.filter(n => timestampIn(n.createdAt)).slice(0, 8),
      };
    }),
});

export const usersRouter = router({
  list: adminProcedure
    .input(logDateRangeSchema.optional())
    .query(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const [members, logs] = await Promise.all([
        collection(db, "bf_app_users")
          .find({ companyId: ctx.user.companyId })
          .sort({ createdAt: 1 })
          .toArray(),
        collection(db, "bf_activity_logs")
          .find({ companyId: ctx.user.companyId })
          .sort({ createdAt: -1 })
          .toArray(),
      ]);
      return {
        members: members.map(publicUser),
        activity: logs
          .filter(x => inDateRange(x.createdAt, input?.from, input?.to))
          .slice(0, 30),
      };
    }),
  invite: adminProcedure
    .input(
      z.object({ email: emailSchema, role: z.enum(["accountant", "viewer"]) })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow(),
        company = await companyFor(ctx.user.id, ctx.user.companyId),
        email = input.email.toLowerCase();
      if (await collection(db, "bf_app_users").findOne({ email }))
        throw new TRPCError({
          code: "CONFLICT",
          message: "This email already has a BillFlow account.",
        });
      const token = randomBytes(32).toString("base64url"),
        tokenHash = createHash("sha256").update(token).digest("hex"),
        invite = await insertRecord(db, "bf_invitations", {
          companyId: ctx.user.companyId,
          email,
          role: input.role,
          tokenHash,
          expiresAt: new Date(Date.now() + 7 * 86400000),
          acceptedAt: null,
          createdBy: ctx.user.id,
          createdAt: new Date(),
        });
      let origin: URL;
      try {
        origin = new URL(ctx.req.headers.origin ?? "");
        if (
          !["http:", "https:"].includes(origin.protocol) ||
          origin.username ||
          origin.password
        )
          throw Error();
      } catch {
        await collection(db, "bf_invitations").deleteOne({ id: invite.id });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "The application origin is unavailable. Please retry from BillFlow.",
        });
      }
      const link = new URL("/", origin.origin);
      link.searchParams.set("invite", token);
      const result = await deliver(
        email,
        `Invitation to ${company.name} on BillFlow`,
        emailLayout({
          companyName: company.name,
          title: "You’re invited to BillFlow",
          preheader: `${company.name} invited you to join their BillFlow workspace.`,
          content: `<p>Hello,</p><p>You have been invited to join <strong>${escapeHtml(company.name)}</strong> as a <strong>${escapeHtml(input.role)}</strong>.</p><p>BillFlow helps your team manage invoices, payments, and customer records in one place.</p><p>This invitation expires in 7 days.</p>`,
          action: { label: "Accept invitation", href: link.toString() },
        })
      );
      await logNotice(ctx.user.companyId, null, email, "invitation", result);
      if (!result.sent) {
        await collection(db, "bf_invitations").deleteOne({ id: invite.id });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Invitation email could not be delivered: ${result.reason}`,
        });
      }
      await logActivity(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "invited",
        "user",
        invite.id,
        `Invited ${email} as ${input.role}`
      );
      return { success: true };
    }),
  setActive: adminProcedure
    .input(z.object({ id: z.number().positive(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      if (input.id === ctx.user.id)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot deactivate your own account.",
        });
      const member = await collection(db, "bf_app_users").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND" });
      await collection(db, "bf_app_users").updateOne(
        { id: input.id, companyId: ctx.user.companyId },
        { $set: { active: input.active ? 1 : 0 } }
      );
      await logActivity(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        input.active ? "activated" : "deactivated",
        "user",
        input.id,
        `${input.active ? "Activated" : "Deactivated"} ${member.email}`
      );
      return { success: true };
    }),
});

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const c = await companyFor(ctx.user.id, ctx.user.companyId);
    const logo = c.logoKey ? await storageGet(c.logoKey) : null;
    const { _id: _internalId, ...business } = c;
    return { ...business, logoUrl: logo?.url ?? null };
  }),
  resetBusinessData: adminProcedure
    .input(z.object({ confirmation: z.literal("RESET BUSINESS DATA") }))
    .mutation(async ({ ctx }) => {
      const companyId = ctx.user.companyId;
      await withTransaction(async (db, session) => {
        const companies = collection(db, "bf_companies"),
          locked = await companies.findOne({ id: companyId }, { session });
        if (!locked)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Company not found.",
          });
        const docs = await collection(db, "bf_documents")
            .find({ companyId }, { projection: { id: 1 }, session })
            .toArray(),
          challans = await collection(db, "bf_delivery_challans")
            .find({ companyId }, { projection: { id: 1 }, session })
            .toArray(),
          docIds = docs.map(d => d.id),
          challanIds = challans.map(c => c.id);
        await collection(db, "bf_notification_logs").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_document_items").deleteMany(
          { documentId: { $in: docIds } },
          { session }
        );
        await collection(db, "bf_payments").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_bank_transactions").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_expenses").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_delivery_challan_items").deleteMany(
          { challanId: { $in: challanIds } },
          { session }
        );
        await collection(db, "bf_activity_logs").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_documents").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_delivery_challans").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_customers").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_expense_heads").deleteMany(
          { companyId },
          { session }
        );
        await collection(db, "bf_document_counters").deleteMany(
          { companyId },
          { session }
        );
        await companies.updateOne(
          { id: companyId },
          {
            $set: {
              invoiceCounter: 0,
              quotationCounter: 0,
              bankOpeningBalance: "0.00",
              bankOpeningDate: null,
            },
          },
          { session }
        );
        await insertRecord(
          db,
          "bf_activity_logs",
          {
            companyId,
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            action: "reset",
            entity: "business_data",
            entityId: null,
            summary:
              "Admin reset business data, including bank transactions and opening balance. Company settings were retained; invoice, quotation and challan numbering restart at 001 per year.",
            createdAt: new Date(),
          },
          session
        );
      });
      return { success: true };
    }),
  update: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(180),
        email: emailSchema,
        currency: z.string().length(3),
        address: z.string().max(4000).optional(),
        phone: z.string().max(48).optional(),
        gstNumber: z.string().max(80).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      await collection(db, "bf_companies").updateOne(
        { id: ctx.user.companyId },
        {
          $set: {
            name: input.name,
            email: input.email,
            currency: input.currency.toUpperCase(),
            address: input.address || null,
            phone: input.phone || null,
            gstNumber: input.gstNumber || null,
          },
        }
      );
      await logActivity(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        "edited",
        "settings",
        ctx.user.companyId,
        "Updated company settings"
      );
      return { success: true };
    }),
});

export const notificationRouter = router({
  logs: protectedProcedure
    .input(logDateRangeSchema.optional())
    .query(async ({ ctx, input }) => {
      const db = await dbOrThrow(),
        [logs, docs] = await Promise.all([
          collection(db, "bf_notification_logs")
            .find({ companyId: ctx.user.companyId })
            .sort({ createdAt: -1 })
            .toArray(),
          collection(db, "bf_documents")
            .find({ companyId: ctx.user.companyId })
            .toArray(),
        ]);
      const dm = new Map(docs.map(d => [d.id, d]));
      return logs
        .filter(l => inDateRange(l.createdAt, input?.from, input?.to))
        .slice(0, 100)
        .map(log => ({
          log,
          document:
            log.documentId == null ? null : (dm.get(log.documentId) ?? null),
        }));
    }),
  dailyCheck: adminProcedure.mutation(async ({ ctx }) =>
    runBillFlowDailyReminders(ctx.user.companyId)
  ),
});

export async function runBillFlowDailyReminders(companyId?: number) {
  const db = await dbOrThrow(),
    today = dayString(new Date());
  const [invoices, companies, customers] = await Promise.all([
    collection(db, "bf_documents")
      .find({
        kind: "invoice",
        status: { $in: ["sent", "partially_paid", "overdue"] },
        dueDate: { $lte: today },
        ...(companyId ? { companyId } : {}),
      })
      .toArray(),
    collection(db, "bf_companies")
      .find(companyId ? { id: companyId } : {})
      .toArray(),
    collection(db, "bf_customers")
      .find(companyId ? { companyId } : {})
      .toArray(),
  ]);
  const cm = new Map(companies.map(c => [c.id, c])),
    custm = new Map(customers.map(c => [c.id, c]));
  let sent = 0,
    failed = 0,
    blocked = 0;
  for (const doc of invoices) {
    const company = cm.get(doc.companyId);
    if (!company) continue;
    const recipient = company.email,
      outstanding = Math.max(0, amount(doc.total) - amount(doc.amountPaid)),
      dedupe = `daily:${doc.id}:${today}`;
    if (await collection(db, "bf_system_settings").findOne({ key: dedupe }))
      continue;
    const customerName = custm.get(doc.customerId)?.name ?? "customer";
    const html = emailLayout({
      companyName: company.name,
      title: "Payment due reminder",
      preheader: `Invoice ${doc.number} has an outstanding balance.`,
      content: `<p>Hello ${escapeHtml(customerName)},</p><p>This is a friendly reminder that invoice <strong>${escapeHtml(doc.number)}</strong> has an outstanding balance.</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;width:100%;border:1px solid #e2e8f0;border-radius:6px"><tr><td style="padding:12px;color:#64748b">Amount due</td><td align="right" style="padding:12px;font-weight:700">${escapeHtml(company.currency ?? "—")} ${outstanding.toFixed(2)}</td></tr><tr><td style="padding:12px;color:#64748b;border-top:1px solid #e2e8f0">Due date</td><td align="right" style="padding:12px;border-top:1px solid #e2e8f0">${escapeHtml(doc.dueDate ?? "Not specified")}</td></tr></table><p>Please arrange payment at your earliest convenience. If you have already paid, please disregard this message.</p><p>Regards,<br>${escapeHtml(company.name)}</p>`,
    });
    const result = await deliver(
      recipient,
      `Invoice ${doc.number} is due`,
      html
    );
    await logNotice(doc.companyId, doc.id, recipient, "daily_alert", result);
    await collection(db, "bf_system_settings").updateOne(
      { key: dedupe },
      {
        $set: {
          value: result.sent ? "sent" : "attempted",
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    if (result.sent) sent++;
    else if (result.reason.startsWith("Email delivery is not configured"))
      blocked++;
    else failed++;
  }
  return { checked: invoices.length, sent, failed, blocked };
}
