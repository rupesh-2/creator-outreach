import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.UNSUBSCRIBE_SECRET = "test-secret";
});

describe("unsubscribe tokens", () => {
  it("round-trips and rejects tampering", async () => {
    const { unsubscribeToken, verifyUnsubscribeToken } = await import("./unsubscribe");
    const t = unsubscribeToken("owner-1", "creator-1", "Mia@Example.com");
    expect(verifyUnsubscribeToken(t)).toEqual({ ownerId: "owner-1", creatorId: "creator-1", email: "mia@example.com" });
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify(["owner-1", "creator-2", "x@y.z"])).toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${payload}.AAAA`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
  });
});
