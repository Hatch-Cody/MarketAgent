import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hex] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hex) return false;
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  const actual = Buffer.from(hex, "hex");
  if (actual.length !== derived.length) return false;
  return timingSafeEqual(actual, derived);
}
