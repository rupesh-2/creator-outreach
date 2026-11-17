import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { unsubscribeUrl } from "@/lib/outreach/unsubscribe";
import type { Creator, CreatorStatus, Message } from "@/lib/types";
import { advanceStatus, setStatus } from "./creators";
import { getSettings } from "./settings";

export class OutreachBlocked extends Error {}

/**
 * Guard used before approving or sending anything:
 * - creator or their email is on the do-not-contact list
 * - creator is in a terminal "no" status
 * - an initial message was already sent (on any channel) → only follow-ups allowed
 */
export async function assertCanContact(db: SupabaseClient, ownerId: string, creator: Creator, kind: Message["kind"]) {
  if (creator.status === "do_not_contact" || creator.status === "not_interested")
    throw new OutreachBlocked(`@${creator.handle} is marked "${creator.status.replace(/_/g, " ")}".`);

  const or = [`and(platform.eq.${creator.platform},handle.eq."${creator.handle.toLowerCase()}")`];
  if (creator.business_email) or.push(`email.eq."${creator.business_email.toLowerCase()}"`);
  const { data: dnc } = await db.from("do_not_contact").select("id").eq("owner_id", ownerId).or(or.join(",")).limit(1);
  if (dnc?.length) throw new OutreachBlocked(`@${creator.handle} is on the do-not-contact list.`);

  if (kind === "follow_up") {
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("creator_id", creator.id)
      .eq("kind", "initial")
      .eq("state", "sent");
    if (!count) throw new OutreachBlocked("Send the first message before a follow-up.");
  }

  if (kind === "initial") {
    const { data: sent } = await db
      .from("messages")
      .select("id, channel, sent_at")
      .eq("owner_id", ownerId)
      .eq("creator_id", creator.id)
      .eq("kind", "initial")
      .eq("state", "sent")
      .limit(1);
    if (sent?.length) throw new OutreachBlocked(`An initial message was already sent to @${creator.handle} via ${sent[0].channel}. Send a follow-up instead.`);
  }
}

async function loadMessage(db: SupabaseClient, ownerId: string, messageId: string) {
  const { data: m } = await db.from("messages").select("*").eq("id", messageId).eq("owner_id", ownerId).single<Message>();
  if (!m) throw new Error("Message not found");
  const { data: c } = await db.from("creators").select("*").eq("id", m.creator_id).single<Creator>();
  if (!c) throw new Error("Creator not found");
  return { m, c };
}

export async function approveMessage(db: SupabaseClient, ownerId: string, messageId: string, body: string, subject?: string | null) {
  const { m, c } = await loadMessage(db, ownerId, messageId);
  await assertCanContact(db, ownerId, c, m.kind);
  await db
    .from("messages")
    .update({ body, subject: subject ?? m.subject, state: "approved", approved_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("owner_id", ownerId);
  if (m.kind === "initial") await advanceStatus(db, ownerId, c.id, "approved");
}

async function recordSent(db: SupabaseClient, ownerId: string, m: Message, c: Creator, sentBody: string, providerId?: string) {
  const now = new Date();
  await db
    .from("messages")
    .update({ state: "sent", sent_at: now.toISOString(), sent_body: sentBody, provider_message_id: providerId ?? null })
    .eq("id", m.id)
    .eq("owner_id", ownerId);
  // Default follow-up 5 days later unless one is already set in the future.
  const followUp = new Date(now.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
  await db
    .from("creators")
    .update({ last_contacted_at: now.toISOString(), ...(c.follow_up_at && c.follow_up_at > followUp ? {} : { follow_up_at: followUp }) })
    .eq("id", c.id);
  await db.from("contact_events").insert({ owner_id: ownerId, creator_id: c.id, type: "sent", message_id: m.id, body: `${m.kind} via ${m.channel}` });
  if (c.status !== "contacted") {
    const early: CreatorStatus[] = ["discovered", "analyzed", "qualified", "pending_review", "approved"];
    if (early.includes(c.status)) await setStatus(db, ownerId, c.id, "contacted", c.status);
  }
}

/** DMs are sent by the operator by hand; this records exactly what was sent. */
export async function markSentManually(db: SupabaseClient, ownerId: string, messageId: string, sentBody: string) {
  const { m, c } = await loadMessage(db, ownerId, messageId);
  if (m.state !== "approved") throw new OutreachBlocked("Approve the message before marking it sent.");
  await assertCanContact(db, ownerId, c, m.kind);
  await recordSent(db, ownerId, m, c, sentBody);
}

export async function sendApprovedEmail(db: SupabaseClient, ownerId: string, messageId: string) {
  const { m, c } = await loadMessage(db, ownerId, messageId);
  if (m.channel !== "email") throw new Error("Not an email message");
  if (m.state !== "approved") throw new OutreachBlocked("Approve the email before sending.");
  if (!c.business_email) throw new OutreachBlocked("No public business email for this creator.");
  await assertCanContact(db, ownerId, c, m.kind);

  const key = env.resendKey();
  const from = env.emailFrom();
  if (!key || !from) throw new OutreachBlocked("Email sending isn't configured (RESEND_API_KEY / EMAIL_FROM).");

  const settings = await getSettings(db, ownerId);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("channel", "email")
    .eq("state", "sent")
    .gte("sent_at", since);
  if ((count ?? 0) >= settings.daily_email_limit)
    throw new OutreachBlocked(`Daily email limit reached (${settings.daily_email_limit} in the last 24h). Change it in Settings.`);

  const unsub = unsubscribeUrl(ownerId, c.id, c.business_email);
  const text = `${m.body}\n\n—\nIf you'd rather not hear from me again, click here and I won't email you again: ${unsub}`;
  let subject = m.subject ?? "Hello";
  if (m.kind === "follow_up" && !m.subject) {
    const { data: first } = await db
      .from("messages")
      .select("subject")
      .eq("creator_id", c.id)
      .eq("channel", "email")
      .eq("kind", "initial")
      .eq("state", "sent")
      .limit(1)
      .maybeSingle();
    subject = first?.subject ? `Re: ${first.subject}` : "Following up";
  }

  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from,
    to: c.business_email,
    subject,
    text,
    replyTo: settings.sender_email ?? undefined,
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  if (error) throw new Error(`Email send failed: ${error.message}`);
  await recordSent(db, ownerId, m, c, text, data?.id);
}

export async function logReply(
  db: SupabaseClient,
  ownerId: string,
  creatorId: string,
  input: { body: string; channel: Message["channel"]; sentiment: "positive" | "neutral" | "negative" },
) {
  const { data: msg } = await db
    .from("messages")
    .insert({ owner_id: ownerId, creator_id: creatorId, channel: input.channel, kind: "reply", state: "received", body: input.body, sent_at: new Date().toISOString() })
    .select("id")
    .single();
  await db.from("contact_events").insert({ owner_id: ownerId, creator_id: creatorId, type: "reply", message_id: msg?.id, sentiment: input.sentiment, body: input.body });
  const { data: c } = await db.from("creators").select("status").eq("id", creatorId).single();
  const to: CreatorStatus = input.sentiment === "positive" ? "interested" : input.sentiment === "negative" ? "not_interested" : "replied";
  const early: CreatorStatus[] = ["discovered", "analyzed", "qualified", "pending_review", "approved", "contacted", "replied"];
  if (c && early.includes(c.status)) await setStatus(db, ownerId, creatorId, to, c.status);
  // A reply clears the pending follow-up.
  await db.from("creators").update({ follow_up_at: null }).eq("id", creatorId);
}

export async function addToDoNotContact(db: SupabaseClient, ownerId: string, creator: Pick<Creator, "id" | "platform" | "handle" | "business_email">, reason: string) {
  const insert = async (row: Record<string, unknown>) => {
    const { error } = await db.from("do_not_contact").insert({ owner_id: ownerId, reason, ...row });
    if (error && error.code !== "23505") throw error; // 23505 = already listed
  };
  await insert({ platform: creator.platform, handle: creator.handle.toLowerCase() });
  if (creator.business_email) await insert({ email: creator.business_email.toLowerCase() });
  await setStatus(db, ownerId, creator.id, "do_not_contact", undefined, reason);
  await db.from("messages").update({ state: "discarded" }).eq("creator_id", creator.id).in("state", ["draft", "approved"]);
  await db.from("creators").update({ follow_up_at: null }).eq("id", creator.id);
}
