import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Stateless signed token: base64url(ownerId.creatorId.email).sig */
export function unsubscribeToken(ownerId: string, creatorId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify([ownerId, creatorId, email.toLowerCase()])).toString("base64url");
  const sig = createHmac("sha256", env.unsubscribeSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): { ownerId: string; creatorId: string; email: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", env.unsubscribeSecret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const [ownerId, creatorId, email] = JSON.parse(Buffer.from(payload, "base64url").toString());
    return { ownerId, creatorId, email };
  } catch {
    return null;
  }
}

export function unsubscribeUrl(ownerId: string, creatorId: string, email: string) {
  return `${env.appUrl()}/unsubscribe?t=${unsubscribeToken(ownerId, creatorId, email)}`;
}
