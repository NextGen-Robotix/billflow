import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  collection,
  getDb,
  insertRecord,
  insertRecords,
  nextId,
  withTransaction,
} from "./mongoDb";
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
const challanInput = z.object({
  id: z.number().int().positive().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  challanDate: dateField,
  status: z.enum(["draft", "sent"]).default("draft"),
  consigneeName: z.string().trim().min(1).max(180),
  consigneeAddress: z.string().max(2000).optional(),
  placeOfDelivery: z.string().max(240).optional(),
  consigneePhone: z.string().max(40).optional(),
  consigneeGst: z.string().max(80).optional(),
  dispatchMode: z.enum(["hand", "transport"]).default("hand"),
  transporter: z.string().max(180).optional(),
  vehicleNo: z.string().max(60).optional(),
  ewayBillNo: z.string().max(60).optional(),
  notes: z.string().max(4000).optional(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(240),
        hsn: z.string().max(40).optional(),
        quantity: z.number().positive().max(1000000),
        unit: z.string().trim().min(1).max(32).default("pcs"),
        rate: z.number().min(0).max(100000000),
      })
    )
    .min(1)
    .max(80),
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

async function logAction(
  db: Awaited<ReturnType<typeof getDb>>,
  companyId: number,
  actorId: number,
  actorName: string,
  action: string,
  id: number,
  description: string,
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
      entity: "delivery_challan",
      entityId: id,
      summary: description.slice(0, 280),
      createdAt: new Date(),
    },
    session
  );
}

const rowAmount = (quantity: number, rate: number) =>
  Math.round(quantity * rate * 100) / 100;

export const challansRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().max(120).optional(),
          dateFrom: dateField.optional(),
          dateTo: dateField.optional(),
        })
        .refine(
          input =>
            !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo,
          { message: "Start date must be on or before end date." }
        )
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await database();
      const filter: Record<string, unknown> = { companyId: ctx.user.companyId };
      const dateFilter: Record<string, string> = {};
      if (input?.dateFrom) dateFilter.$gte = input.dateFrom;
      if (input?.dateTo) dateFilter.$lte = input.dateTo;
      if (Object.keys(dateFilter).length) filter.challanDate = dateFilter;
      const challans = await collection(db, "bf_delivery_challans")
        .find(filter as never)
        .sort({ challanDate: -1, id: -1 })
        .toArray();
      const customerIds = [
        ...new Set(
          challans.flatMap(row => (row.customerId ? [row.customerId] : []))
        ),
      ];
      const customerRows = customerIds.length
        ? await collection(db, "bf_customers")
            .find({
              companyId: ctx.user.companyId,
              id: { $in: customerIds },
            } as never)
            .toArray()
        : [];
      const customersById = new Map(
        customerRows.map(customer => [customer.id, customer])
      );
      const rows = challans.map(challan => ({
        challan,
        customer: challan.customerId
          ? (customersById.get(challan.customerId) ?? null)
          : null,
      }));
      const search = input?.search?.trim().toLowerCase();
      return search
        ? rows.filter(
            row =>
              row.challan.number.toLowerCase().includes(search) ||
              row.challan.consigneeName.toLowerCase().includes(search) ||
              row.customer?.name.toLowerCase().includes(search)
          )
        : rows;
    }),

  detail: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await database();
      const challan = await collection(db, "bf_delivery_challans").findOne({
        id: input.id,
        companyId: ctx.user.companyId,
      } as never);
      if (!challan)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Delivery challan not found.",
        });
      const customer = challan.customerId
        ? await collection(db, "bf_customers").findOne({
            id: challan.customerId,
            companyId: ctx.user.companyId,
          } as never)
        : null;
      const items = await collection(db, "bf_delivery_challan_items")
        .find({ challanId: input.id } as never)
        .sort({ id: 1 })
        .toArray();
      return { challan, customer, items };
    }),

  save: accountantProcedure
    .input(challanInput)
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const customerId = input.customerId || null;
      if (customerId) {
        const customer = await collection(db, "bf_customers").findOne({
          id: customerId,
          companyId: ctx.user.companyId,
        } as never);
        if (!customer)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Choose a customer in your workspace.",
          });
      }

      const serializedItems = input.items.map(item => {
        const amount = rowAmount(item.quantity, item.rate);
        return {
          name: item.name.trim(),
          hsn: item.hsn?.trim() || null,
          quantity: String(item.quantity),
          unit: item.unit.trim(),
          rate: item.rate.toFixed(2),
          total: amount.toFixed(2),
        };
      });
      const total =
        Math.round(
          serializedItems.reduce((sum, item) => sum + Number(item.total), 0) *
            100
        ) / 100;
      if (!Number.isFinite(total) || total > 1000000000)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Challan total is outside the supported range.",
        });

      const values = {
        customerId,
        challanDate: input.challanDate,
        status: input.status,
        consigneeName: input.consigneeName.trim(),
        consigneeAddress: input.consigneeAddress?.trim() || null,
        placeOfDelivery: input.placeOfDelivery?.trim() || null,
        consigneePhone: input.consigneePhone?.trim() || null,
        consigneeGst: input.consigneeGst?.trim() || null,
        dispatchMode: input.dispatchMode,
        transporter:
          input.dispatchMode === "transport"
            ? input.transporter?.trim() || null
            : null,
        vehicleNo:
          input.dispatchMode === "transport"
            ? input.vehicleNo?.trim() || null
            : null,
        ewayBillNo:
          input.dispatchMode === "transport"
            ? input.ewayBillNo?.trim() || null
            : null,
        notes: input.notes?.trim() || null,
        total: total.toFixed(2),
      };

      if (input.id) {
        const saved = await withTransaction(async (transactionDb, session) => {
          const challans = collection(transactionDb, "bf_delivery_challans");
          const existing = await challans.findOne(
            { id: input.id, companyId: ctx.user.companyId } as never,
            { session }
          );
          if (!existing)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Delivery challan not found.",
            });
          await challans.updateOne(
            { id: input.id, companyId: ctx.user.companyId } as never,
            { $set: { ...values, updatedAt: new Date() } } as never,
            { session }
          );
          await collection(
            transactionDb,
            "bf_delivery_challan_items"
          ).deleteMany({ challanId: input.id } as never, { session });
          await insertRecords(
            transactionDb,
            "bf_delivery_challan_items",
            serializedItems.map(item => ({
              ...item,
              challanId: input.id!,
            })),
            session
          );
          await logAction(
            transactionDb,
            ctx.user.companyId,
            ctx.user.id,
            ctx.user.name,
            "edited",
            input.id!,
            `Updated delivery challan ${existing.number}`,
            session
          );
          return { id: existing.id, number: existing.number };
        });
        return { ...saved, total };
      }

      const created = await withTransaction(async (transactionDb, session) => {
        const company = await collection(transactionDb, "bf_companies").findOne(
          { id: ctx.user.companyId } as never,
          { session }
        );
        if (!company)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found.",
          });
        const year = Number(input.challanDate.slice(0, 4));
        const counterId = await nextId(transactionDb, "bf_document_counters");
        const counter = await collection(
          transactionDb,
          "bf_document_counters"
        ).findOneAndUpdate(
          {
            companyId: ctx.user.companyId,
            year,
            kind: "delivery_challan",
          } as never,
          {
            $inc: { counter: 1 },
            $setOnInsert: {
              id: counterId,
              companyId: ctx.user.companyId,
              year,
              kind: "delivery_challan",
            },
          } as never,
          { upsert: true, returnDocument: "after", session }
        );
        if (!counter)
          throw new Error("Could not allocate a delivery challan number.");
        const number = `DC-${year}-${String(counter.counter).padStart(3, "0")}`;
        const challan = await insertRecord(
          transactionDb,
          "bf_delivery_challans",
          {
            ...values,
            companyId: ctx.user.companyId,
            number,
            createdBy: ctx.user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          session
        );
        await insertRecords(
          transactionDb,
          "bf_delivery_challan_items",
          serializedItems.map(item => ({
            ...item,
            challanId: challan.id,
          })),
          session
        );
        await logAction(
          transactionDb,
          ctx.user.companyId,
          ctx.user.id,
          ctx.user.name,
          "created",
          challan.id,
          `Created delivery challan ${number}`,
          session
        );
        return { id: challan.id, number };
      });
      return { ...created, total };
    }),

  remove: accountantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      await withTransaction(async (transactionDb, session) => {
        const challans = collection(transactionDb, "bf_delivery_challans");
        const existing = await challans.findOne(
          { id: input.id, companyId: ctx.user.companyId } as never,
          { session }
        );
        if (!existing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Delivery challan not found.",
          });
        await collection(transactionDb, "bf_delivery_challan_items").deleteMany(
          { challanId: input.id } as never,
          { session }
        );
        await challans.deleteOne(
          { id: input.id, companyId: ctx.user.companyId } as never,
          { session }
        );
        await logAction(
          transactionDb,
          ctx.user.companyId,
          ctx.user.id,
          ctx.user.name,
          "deleted",
          input.id,
          `Deleted challan ${existing.number}`,
          session
        );
      });
      return { success: true };
    }),
});
