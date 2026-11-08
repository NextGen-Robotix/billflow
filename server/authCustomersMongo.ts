import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { AppUser } from "../shared/models";
import {
  collection,
  getDb,
  insertRecord,
  nextId,
  withTransaction,
} from "./mongoDb";
import {
  accountantProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  BILLFLOW_COOKIE,
  BILLFLOW_SESSION_DURATION,
  createAppSession,
  hashPassword,
  verifyPassword,
} from "./_core/billflowAuth";
import { getSessionCookieOptions } from "./_core/cookies";

const emailSchema = z.string().email().max(320);
const passwordSchema = z.string().min(10).max(128);
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

const publicUser = (u: AppUser) => ({
  id: u.id,
  companyId: u.companyId,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active === 1,
  createdAt: u.createdAt,
  lastSignedIn: u.lastSignedIn,
});

async function logActivity(
  companyId: number,
  actorId: number,
  actorName: string,
  action: string,
  entity: string,
  entityId: number | null,
  summary: string
) {
  const db = await getDb();
  await insertRecord(db, "bf_activity_logs", {
    companyId,
    actorId,
    actorName,
    action,
    entity,
    entityId,
    summary,
    createdAt: new Date(),
  });
}

function setSessionCookie(
  ctx: {
    req: Parameters<typeof getSessionCookieOptions>[0];
    res: { cookie: Function };
  },
  user: AppUser
) {
  return createAppSession(user).then(token => {
    ctx.res.cookie(BILLFLOW_COOKIE, token, {
      ...getSessionCookieOptions(ctx.req),
      maxAge: BILLFLOW_SESSION_DURATION,
    });
  });
}

export const authRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    const db = await getDb();
    const company = await collection(db, "bf_companies").findOne({
      id: ctx.user.companyId,
    });
    if (!company)
      throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
    return {
      ...publicUser(ctx.user),
      company: {
        id: company.id,
        name: company.name,
        email: company.email,
        currency: company.currency,
        address: company.address,
        phone: company.phone,
        gstNumber: company.gstNumber,
        logoKey: company.logoKey,
      },
    };
  }),
  signup: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(180),
        companyName: z.string().trim().min(2).max(180),
        email: emailSchema,
        password: passwordSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const email = input.email.toLowerCase();
      const users = collection(db, "bf_app_users");
      if (await users.findOne({ email }, { projection: { id: 1 } }))
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account already exists for that email.",
        });
      const created = await withTransaction(async (txDb, session) => {
        const now = new Date();
        const companyId = await nextId(txDb, "bf_companies");
        const company = {
          id: companyId,
          name: input.companyName,
          email,
          currency: "INR",
          address: null,
          phone: null,
          gstNumber: null,
          logoKey: null,
          bankOpeningBalance: "0",
          bankOpeningDate: null,
          invoiceCounter: 0,
          quotationCounter: 0,
          createdAt: now,
        };
        await collection(txDb, "bf_companies").insertOne(
          { ...company, _id: companyId } as never,
          { session }
        );
        const user = await insertRecord(
          txDb,
          "bf_app_users",
          {
            companyId,
            name: input.name,
            email,
            passwordHash: hashPassword(input.password),
            role: "admin",
            active: 1,
            invitedAt: null,
            createdAt: now,
            updatedAt: now,
            lastSignedIn: null,
          },
          session
        );
        return { companyId, user };
      });
      const user = created.user;
      if (!user)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Account setup failed",
        });
      await setSessionCookie(ctx, user);
      await logActivity(
        created.companyId,
        user.id,
        user.name,
        "created",
        "account",
        user.id,
        "Created the company workspace"
      );
      return publicUser(user);
    }),
  login: publicProcedure
    .input(
      z.object({ email: emailSchema, password: z.string().min(1).max(128) })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const user = await collection(db, "bf_app_users").findOne({
        email: input.email.toLowerCase(),
      });
      if (
        !user ||
        !verifyPassword(input.password, user.passwordHash) ||
        user.active !== 1
      )
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Email or password is incorrect.",
        });
      await collection(db, "bf_app_users").updateOne(
        { id: user.id },
        { $set: { lastSignedIn: new Date(), updatedAt: new Date() } }
      );
      await setSessionCookie(ctx, user);
      return publicUser(user);
    }),
  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie(BILLFLOW_COOKIE, {
      ...getSessionCookieOptions(ctx.req),
      maxAge: 0,
    });
    return { success: true };
  }),
  acceptInvite: publicProcedure
    .input(
      z.object({
        token: z.string().min(30),
        name: z.string().trim().min(2).max(180),
        password: passwordSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const accepted = await withTransaction(async (txDb, session) => {
        const invitations = collection(txDb, "bf_invitations");
        const now = new Date();
        // This conditional claim is atomic: only one concurrent acceptance can consume the token.
        const invite = await invitations.findOneAndUpdate(
          { tokenHash, acceptedAt: null, expiresAt: { $gt: now } },
          { $set: { acceptedAt: now } },
          { session, returnDocument: "before" }
        );
        if (!invite)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This invitation is invalid or expired.",
          });
        const company = await collection(txDb, "bf_companies").findOne(
          { id: invite.companyId },
          { session }
        );
        if (!company)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invitation workspace no longer exists.",
          });
        if (
          await collection(txDb, "bf_app_users").findOne(
            { email: invite.email },
            { session, projection: { id: 1 } }
          )
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This email already has a BillFlow account. Ask the workspace admin to invite a different address.",
          });
        const user = await insertRecord(
          txDb,
          "bf_app_users",
          {
            companyId: invite.companyId,
            name: input.name,
            email: invite.email,
            passwordHash: hashPassword(input.password),
            role: invite.role,
            active: 1,
            invitedAt: invite.createdAt,
            createdAt: now,
            updatedAt: now,
            lastSignedIn: null,
          },
          session
        );
        return { user, role: invite.role };
      });
      await setSessionCookie(ctx, accepted.user);
      await logActivity(
        accepted.user.companyId,
        accepted.user.id,
        accepted.user.name,
        "joined",
        "user",
        accepted.user.id,
        `Joined as ${accepted.role}`
      );
      return publicUser(accepted.user);
    }),
});

export const customersRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const filter: Record<string, unknown> = { companyId: ctx.user.companyId };
      if (input?.search)
        filter.name = {
          $regex: input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        };
      return collection(db, "bf_customers")
        .find(filter)
        .sort({ updatedAt: -1 })
        .toArray();
    }),
  save: accountantProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(180),
        email: z.union([emailSchema, z.literal("")]).optional(),
        phone: z.string().max(48).optional(),
        taxId: z.string().max(80).optional(),
        address: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const values = {
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        taxId: input.taxId || null,
        address: input.address || null,
      };
      const customers = collection(db, "bf_customers");
      let id = input.id;
      if (id) {
        const owns = await customers.findOne(
          { id, companyId: ctx.user.companyId },
          { projection: { id: 1 } }
        );
        if (!owns) throw new TRPCError({ code: "NOT_FOUND" });
        await customers.updateOne(
          { id, companyId: ctx.user.companyId },
          { $set: { ...values, updatedAt: new Date() } }
        );
      } else {
        const now = new Date();
        const created = await insertRecord(db, "bf_customers", {
          ...values,
          companyId: ctx.user.companyId,
          createdAt: now,
          updatedAt: now,
        });
        id = created.id;
      }
      await logActivity(
        ctx.user.companyId,
        ctx.user.id,
        ctx.user.name,
        input.id ? "edited" : "created",
        "customer",
        id!,
        `${input.id ? "Updated" : "Added"} customer ${input.name}`
      );
      return customers.findOne({ id, companyId: ctx.user.companyId });
    }),
  ledger: protectedProcedure
    .input(
      z
        .object({
          customerId: z.number().int().positive(),
          from: dateField.optional(),
          to: dateField.optional(),
        })
        .refine(input => !input.from || !input.to || input.from <= input.to, {
          message: "Start date must be on or before end date.",
          path: ["to"],
        })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const customer = await collection(db, "bf_customers").findOne({
        id: input.customerId,
        companyId: ctx.user.companyId,
      });
      if (!customer) throw new TRPCError({ code: "NOT_FOUND" });
      const docFilter: Record<string, unknown> = {
        companyId: ctx.user.companyId,
        customerId: input.customerId,
      };
      if (input.from || input.to) {
        const range: Record<string, string> = {};
        if (input.from) range.$gte = input.from;
        if (input.to) range.$lte = input.to;
        docFilter.issueDate = range;
      }
      const docs = await db
        .collection("bf_documents")
        .find(docFilter)
        .sort({ issueDate: -1 })
        .toArray();
      const outstanding = docs
        .filter(d => d.kind === "invoice" && d.status !== "draft")
        .reduce(
          (sum, d) =>
            sum + Math.max(0, Number(d.total ?? 0) - Number(d.amountPaid ?? 0)),
          0
        );
      return { customer, documents: docs, outstanding };
    }),
});
