/**
 * Applies the real migration to an in-process Postgres (PGlite) with a minimal
 * stub of Supabase's auth schema, then exercises the constraints and the job queue.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_STUB = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

let db: PGlite;
const owner = "00000000-0000-0000-0000-000000000001";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = path.join(import.meta.dirname, "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  await db.exec(`insert into auth.users values ('${owner}')`);
});

describe("schema", () => {
  it("enforces one creator per (owner, platform, handle) and lowercase handles", async () => {
    const ins = (h: string) =>
      db.query(`insert into creators (owner_id, platform, handle, profile_url, data_source) values ($1, 'instagram', $2, 'x', 'csv')`, [owner, h]);
    await ins("mia");
    await expect(ins("mia")).rejects.toThrow(/creators_owner_platform_handle/);
    await expect(ins("Mia")).rejects.toThrow(/check/);
  });

  it("upsert on (owner_id, platform, handle) keeps CRM status", async () => {
    await db.query(`update creators set status = 'contacted' where handle = 'mia'`);
    await db.query(
      `insert into creators (owner_id, platform, handle, profile_url, data_source, followers) values ($1,'instagram','mia','x','apify',123)
       on conflict (owner_id, platform, handle) do update set followers = excluded.followers`,
      [owner],
    );
    const { rows } = await db.query<{ status: string; followers: number }>(`select status, followers from creators where handle='mia'`);
    expect(rows[0]).toEqual({ status: "contacted", followers: 123 });
  });

  it("do-not-contact is unique per handle and per email (case-insensitive)", async () => {
    await db.query(`insert into do_not_contact (owner_id, platform, handle) values ($1,'tiktok','abc')`, [owner]);
    await expect(db.query(`insert into do_not_contact (owner_id, platform, handle) values ($1,'tiktok','ABC')`, [owner])).rejects.toThrow(/dnc_handle/);
    await db.query(`insert into do_not_contact (owner_id, email) values ($1,'a@b.co')`, [owner]);
    await expect(db.query(`insert into do_not_contact (owner_id, email) values ($1,'A@B.co')`, [owner])).rejects.toThrow(/dnc_email/);
    await expect(db.query(`insert into do_not_contact (owner_id) values ($1)`, [owner])).rejects.toThrow(/check/);
  });

  it("claim_jobs claims only runnable jobs, once, and bumps attempts", async () => {
    await db.query(`insert into jobs (owner_id, type) values ($1,'analyze'), ($1,'analyze')`, [owner]);
    await db.query(`insert into jobs (owner_id, type, run_after) values ($1,'analyze', now() + interval '1 hour')`, [owner]);
    const first = await db.query<{ attempts: number; status: string }>(`select * from claim_jobs(5)`);
    expect(first.rows).toHaveLength(2);
    expect(first.rows.every((j) => j.status === "running" && j.attempts === 1)).toBe(true);
    const second = await db.query(`select * from claim_jobs(5)`);
    expect(second.rows).toHaveLength(0);
    const scoped = await db.query(`select * from claim_jobs(5, '00000000-0000-0000-0000-000000000002')`);
    expect(scoped.rows).toHaveLength(0);
  });

  it("enables RLS with an owner policy on every table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(rows.length).toBe(10);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    const { rows: pol } = await db.query(`select tablename from pg_policies where policyname = 'owner_all'`);
    expect(pol).toHaveLength(10);
  });
});
