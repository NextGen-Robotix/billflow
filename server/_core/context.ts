import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookies } from "cookie";
import type { AppUser } from "../../shared/models";
import { BILLFLOW_COOKIE, resolveAppSession } from "./billflowAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AppUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const cookies = parseCookies(opts.req.headers.cookie ?? "");
  const bearer = opts.req.headers.authorization?.startsWith("Bearer ")
    ? opts.req.headers.authorization.slice(7)
    : undefined;
  const user = await resolveAppSession(cookies[BILLFLOW_COOKIE] ?? bearer);
  return { req: opts.req, res: opts.res, user };
}
