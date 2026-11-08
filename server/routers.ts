import {
  authRouter,
  customersRouter,
  dashboardRouter,
  documentsRouter,
  notificationRouter,
  paymentsRouter,
  settingsRouter,
  usersRouter,
} from "./billflow";
import { expensesRouter } from "./expenses";
import { challansRouter } from "./challans";
import { documentFormatRouter } from "./documentFormat";
import { bankReceiptsRouter } from "./bankReceipts";
import { router } from "./_core/trpc";

export const appRouter = router({
  auth: authRouter,
  customers: customersRouter,
  documents: documentsRouter,
  payments: paymentsRouter,
  dashboard: dashboardRouter,
  users: usersRouter,
  settings: settingsRouter,
  notifications: notificationRouter,
  expenses: expensesRouter,
  challans: challansRouter,
  documentFormat: documentFormatRouter,
  bankReceipts: bankReceiptsRouter,
});

export type AppRouter = typeof appRouter;
