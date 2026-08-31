import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Client, User } from "@/db/schema";
import * as repo from "./repo";

export interface Session {
  authUserId: string;
  email: string;
  user: User;
  client: Client;
}

/**
 * The single tenancy boundary for the UI.
 *
 * Every dashboard page and every server action calls this. It resolves the
 * Supabase auth user to a row in our own `users` table and returns that row's
 * client — so no page ever takes a client_id from the URL or a form field.
 */
export async function requireSession(): Promise<Session> {
  const supabase = await createServerSupabase();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.email) redirect("/login");

  const user = await repo.getUserByEmail(authUser.email);
  if (!user) redirect("/login?error=no_account");
  if (!user.clientId) redirect("/login?error=no_client");

  const client = await repo.getClientById(user.clientId);
  if (!client) redirect("/login?error=no_client");

  return { authUserId: authUser.id, email: authUser.email, user, client };
}

/** Owner-only areas (/admin). */
export async function requireOwner(): Promise<Session> {
  const session = await requireSession();
  if (session.user.role !== "owner") redirect("/dashboard?error=forbidden");
  return session;
}

/** Non-redirecting variant, for the nav. */
export async function getOptionalSession(): Promise<Session | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser?.email) return null;

  const user = await repo.getUserByEmail(authUser.email);
  if (!user?.clientId) return null;
  const client = await repo.getClientById(user.clientId);
  if (!client) return null;

  return { authUserId: authUser.id, email: authUser.email, user, client };
}
