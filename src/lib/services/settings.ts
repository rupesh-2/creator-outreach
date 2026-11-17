import type { SupabaseClient } from "@supabase/supabase-js";
import type { Settings } from "@/lib/types";

export async function getSettings(db: SupabaseClient, ownerId: string): Promise<Settings> {
  const { data } = await db.from("settings").select("*").eq("owner_id", ownerId).maybeSingle();
  if (data) return data as Settings;
  const { data: created, error } = await db.from("settings").insert({ owner_id: ownerId }).select("*").single();
  if (error) throw error;
  return created as Settings;
}
