import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { runBillFlowDailyReminders } from "../billflow";
import { closeMongoDb, getDb } from "../mongoDb";

function scheduleDailyReminderFallback() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(9, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const timer = setTimeout(async () => {
    try { console.info("[BillFlow] Starting daily reminder check", await runBillFlowDailyReminders()); }
    catch (error) { console.error("[BillFlow] Daily reminder check failed", error); }
    scheduleDailyReminderFallback();
  }, next.getTime() - now.getTime());
  timer.unref();
}

async function startServer() {
  console.info("[BillFlow] Connecting to MongoDB...");
  await getDb();
  console.info("[BillFlow] MongoDB connection ready");

  const app = express();
  app.set("trust proxy", 1);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", async (_req, res) => {
    try {
      await getDb();
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.post("/api/scheduled/daily-invoices", async (req, res) => {
    try {
      const token = process.env.SCHEDULED_JOB_TOKEN;
      if (!token || req.headers.authorization !== `Bearer ${token}`) {
        res.status(401).json({ error: "Invalid scheduled-work token" });
        return;
      }
      res.status(200).json(await runBillFlowDailyReminders());
    } catch (error) {
      console.error("[BillFlow] Scheduled callback failed", error);
      res.status(401).json({ error: "Scheduled callback authentication or processing failed" });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  if (process.env.ENABLE_INTERNAL_SCHEDULER === "true") {
    scheduleDailyReminderFallback();
  }
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  const shutdown = async (signal: string) => {
    console.info(`[BillFlow] Received ${signal}; shutting down`);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeMongoDb();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
