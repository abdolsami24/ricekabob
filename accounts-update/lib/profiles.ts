// Customer/staff profiles, keyed by Supabase Auth user id.
// All reads/writes go through the service client from API routes that have
// already verified the caller's token — the profiles table itself has RLS
// enabled with no public policies.

import { getServiceClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  role: "customer" | "staff";
  display_name: string | null;
  phone: string | null;
  default_address: string | null;
  created_at: string;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, display_name, phone, default_address, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[profiles] read failed:", error);
    return null;
  }
  return (data as Profile) ?? null;
}

/** Returns the user's profile, creating a default 'customer' one if needed. */
export async function ensureProfile(user: User): Promise<Profile | null> {
  const existing = await getProfile(user.id);
  if (existing) return existing;
  const supabase = getServiceClient();
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  const { data, error } = await supabase
    .from("profiles")
    .insert({ id: user.id, role: "customer", display_name: displayName })
    .select("id, role, display_name, phone, default_address, created_at")
    .single();
  if (error) {
    console.error("[profiles] create failed:", error);
    return null;
  }
  return data as Profile;
}
