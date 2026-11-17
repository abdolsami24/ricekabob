// Server-side Supabase helpers.
// - getServiceClient(): service-role client (SERVER ONLY — bypasses RLS,
//   used by API routes after they have done their own checks).
// - verifyAnyUser(): validates a Supabase Auth access token (any account).
// - verifyCustomerUser(): any signed-in customer (same as verifyAnyUser).
// - verifyKitchenUser(): signed-in user whose profile role is 'staff'.
//   This separation matters: once customers can register on the website,
//   a customer token must NEVER open the kitchen APIs.

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

let serviceClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  if (!serviceClient) {
    serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return serviceClient;
}

/**
 * Verifies the Authorization: Bearer <supabase-access-token> header.
 * Returns the authenticated user (customer or staff), or null.
 */
export async function verifyAnyUser(req: Request): Promise<User | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/** Any signed-in website customer. */
export async function verifyCustomerUser(req: Request): Promise<User | null> {
  return verifyAnyUser(req);
}

/**
 * Kitchen access: the caller must be signed in AND have role 'staff' in
 * the profiles table (see supabase/accounts-schema.sql, which promotes
 * the pre-existing kitchen account to staff).
 */
export async function verifyKitchenUser(req: Request): Promise<User | null> {
  const user = await verifyAnyUser(req);
  if (!user) return null;
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (error || !data || data.role !== "staff") return null;
    return user;
  } catch {
    return null;
  }
}
