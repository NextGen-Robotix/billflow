import {
  MongoClient,
  type ClientSession,
  type Collection,
  type Db,
  type Document as MongoDocument,
} from "mongodb";
import type {
  ActivityLog,
  AppUser,
  BankTransaction,
  Company,
  Customer,
  DeliveryChallan,
  DeliveryChallanItem,
  Document as BillDocument,
  DocumentCounter,
  DocumentFormat,
  DocumentItem,
  Expense,
  ExpenseHead,
  Invitation,
  MongoRecord,
  NotificationLog,
  Payment,
  SystemSetting,
  User,
} from "../shared/models";

export interface CollectionTypes {
  users: User;
  bf_companies: Company;
  bf_app_users: AppUser;
  bf_customers: Customer;
  bf_documents: BillDocument;
  bf_document_items: DocumentItem;
  bf_payments: Payment;
  bf_bank_transactions: BankTransaction;
  bf_expenses: Expense;
  bf_expense_heads: ExpenseHead;
  bf_delivery_challans: DeliveryChallan;
  bf_delivery_challan_items: DeliveryChallanItem;
  bf_document_formats: DocumentFormat;
  bf_activity_logs: ActivityLog;
  bf_notification_logs: NotificationLog;
  bf_invitations: Invitation;
  bf_system_settings: SystemSetting;
  bf_document_counters: DocumentCounter;
}

export type CollectionName = keyof CollectionTypes;
type IdCollectionName = Exclude<CollectionName, "bf_system_settings">;
export type BillCollection<T extends CollectionName> = Collection<
  CollectionTypes[T] & MongoDocument
>;

let client: MongoClient | undefined;
let connectedDb: Db | undefined;
let connectPromise: Promise<Db> | undefined;

function localPlaceholderUri() {
  return "mongodb://127.0.0.1:27017/billflow?replicaSet=rs0";
}

const MONGODB_LOCAL_PLACEHOLDER = localPlaceholderUri();

async function ensureIndexes(db: Db) {
  const specs: Array<[CollectionName, MongoDocument[]]> = [
    [
      "users",
      [
        { key: { id: 1 }, unique: true },
        { key: { openId: 1 }, unique: true },
      ],
    ],
    ["bf_companies", [{ key: { id: 1 }, unique: true }]],
    [
      "bf_app_users",
      [
        { key: { id: 1 }, unique: true },
        { key: { email: 1 }, unique: true },
        { key: { companyId: 1, createdAt: 1 } },
      ],
    ],
    [
      "bf_customers",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, updatedAt: -1 } },
      ],
    ],
    [
      "bf_documents",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, number: 1 }, unique: true },
        { key: { companyId: 1, issueDate: -1 } },
        { key: { companyId: 1, status: 1 } },
        { key: { customerId: 1 } },
      ],
    ],
    [
      "bf_document_items",
      [{ key: { id: 1 }, unique: true }, { key: { documentId: 1 } }],
    ],
    [
      "bf_payments",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, paymentDate: -1 } },
        { key: { documentId: 1 } },
      ],
    ],
    [
      "bf_bank_transactions",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, transactionDate: 1, id: 1 } },
      ],
    ],
    [
      "bf_expenses",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, date: -1, id: -1 } },
        { key: { companyId: 1, paidBy: 1 } },
        { key: { invoiceId: 1 } },
      ],
    ],
    [
      "bf_expense_heads",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, name: 1 }, unique: true },
      ],
    ],
    [
      "bf_delivery_challans",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, number: 1 }, unique: true },
        { key: { companyId: 1, challanDate: -1, id: -1 } },
      ],
    ],
    [
      "bf_delivery_challan_items",
      [{ key: { id: 1 }, unique: true }, { key: { challanId: 1 } }],
    ],
    [
      "bf_document_formats",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1 }, unique: true },
      ],
    ],
    [
      "bf_activity_logs",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, createdAt: -1 } },
      ],
    ],
    [
      "bf_notification_logs",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, createdAt: -1 } },
      ],
    ],
    [
      "bf_invitations",
      [
        { key: { id: 1 }, unique: true },
        { key: { tokenHash: 1 }, unique: true },
        { key: { companyId: 1, email: 1 } },
      ],
    ],
    ["bf_system_settings", [{ key: { key: 1 }, unique: true }]],
    [
      "bf_document_counters",
      [
        { key: { id: 1 }, unique: true },
        { key: { companyId: 1, year: 1, kind: 1 }, unique: true },
      ],
    ],
  ];
  await Promise.all(
    specs.map(([name, indexes]) =>
      db.collection(name).createIndexes(indexes as never)
    )
  );
}

export async function getDb(): Promise<Db> {
  if (connectedDb) return connectedDb;
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    // const configuredUri = process.env.MONGODB_URI?.trim();
    const configuredUri = process.env.MONGODB_URI?.trim();
    if (process.env.NODE_ENV === "production" && !configuredUri) {
      connectPromise = undefined;
      throw new Error(
        "MONGODB_URI must be configured in production. Use a MongoDB Atlas replica-set connection string.",
      );
    }
    const uri = configuredUri || localPlaceholderUri();
    const dbName = process.env.MONGODB_DATABASE?.trim() || "billflow";
    const nextClient = new MongoClient(uri, {
      appName: "billflow",
      serverSelectionTimeoutMS: 7000,
      retryWrites: true,
    });
    try {
      await nextClient.connect();
      const db = nextClient.db(dbName);
      await ensureIndexes(db);
      client = nextClient;
      connectedDb = db;
      return db;
    } catch (error) {
      await nextClient.close().catch(() => undefined);
      connectPromise = undefined;
      const detail =
        error instanceof Error ? error.message : "unknown connection error";
      throw new Error(
        `MongoDB is unavailable. Set MONGODB_URI to a reachable MongoDB replica set (local example: ${localPlaceholderUri()}). ${detail}`
      );
    }
  })();
  return connectPromise;
}

export function collection<T extends CollectionName>(
  db: Db,
  name: T
): BillCollection<T> {
  return db.collection<CollectionTypes[T] & MongoDocument>(name);
}

export async function nextId(
  db: Db,
  sequenceName: CollectionName | "bf_sequences"
) {
  const row = await db
    .collection<{ _id: string; value: number }>("bf_sequences")
    .findOneAndUpdate(
      { _id: sequenceName },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: "after" }
    );
  if (!row) throw new Error(`Could not allocate an ID for ${sequenceName}.`);
  return row.value;
}

export async function insertRecord<T extends IdCollectionName>(
  db: Db,
  name: T,
  values: Omit<CollectionTypes[T], "id">,
  session?: ClientSession
): Promise<CollectionTypes[T]> {
  const id = await nextId(db, name);
  const row = { ...values, id } as CollectionTypes[T];
  await collection(db, name).insertOne({ ...row, _id: id } as never, {
    session,
  });
  return row;
}

export async function insertRecords<T extends IdCollectionName>(
  db: Db,
  name: T,
  values: Array<Omit<CollectionTypes[T], "id">>,
  session?: ClientSession
): Promise<CollectionTypes[T][]> {
  if (!values.length) return [];
  const rows: CollectionTypes[T][] = [];
  for (const value of values)
    rows.push({ ...value, id: await nextId(db, name) } as CollectionTypes[T]);
  await collection(db, name).insertMany(
    rows.map(row => ({ ...row, _id: row.id })) as never,
    { session }
  );
  return rows;
}

export async function withTransaction<T>(
  work: (db: Db, session: ClientSession) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!client) throw new Error("MongoDB client is not initialized.");
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(db, session);
      return result;
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (
      /transaction numbers are only allowed|replica set|mongos/i.test(message)
    ) {
      throw new Error(
        "BillFlow requires MongoDB transactions. Use MongoDB Atlas or run the local MongoDB server as a replica set (for example replicaSet=rs0)."
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function closeMongoDb() {
  const current = client;
  client = undefined;
  connectedDb = undefined;
  connectPromise = undefined;
  if (current) await current.close();
}
