import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AppUser } from "../../shared/models";
import { collection, getDb } from "../mongoDb";
import { BILLFLOW_COOKIE } from "./billflowConst";

const encoder = new TextEncoder();
const SESSION_MS = 1000 * 60 * 60 * 24 * 7;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, digestHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !digestHex) return false;
  try {
    const expected = Buffer.from(digestHex, "hex");
    const actual = scryptSync(
      password,
      Buffer.from(saltHex, "hex"),
      expected.length
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

async function signingKey() {
  const db = await getDb();
  const settings = db.collection<{
    key: string;
    value: string;
    updatedAt: Date;
  }>("bf_system_settings");
  const key = "billflow_session_key_v1";
  const generated = randomBytes(48).toString("base64url");
  const setting = await settings.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, value: generated, updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  if (!setting)
    throw new Error("Could not initialize the application session key");
  return encoder.encode(setting.value);
}

export async function createAppSession(user: AppUser) {
  const key = await signingKey();
  return new SignJWT({ companyId: user.companyId, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export async function resolveAppSession(
  token: string | undefined
): Promise<AppUser | null> {
  if (!token) return null;
  try {
    const key = await signingKey();
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (!payload.sub || !/^\d+$/.test(payload.sub)) return null;
    const user = await collection(
      await getDb(),
      "bf_app_users",
    ).findOne({ id: Number(payload.sub) });
    return user?.active === 1 ? user : null;
  } catch {
    return null;
  }
}

export const BILLFLOW_SESSION_DURATION = SESSION_MS;
export { BILLFLOW_COOKIE };
