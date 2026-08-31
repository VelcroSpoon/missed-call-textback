import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import * as repo from "@/server/repo";

export const dynamic = "force-dynamic";

/**
 * Magic-link landing route. Exchanges the code for a session, then makes sure
 * our own `users` row is bound to the Supabase auth id.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (!code) return NextResponse.redirect(new URL("/login?error=auth", url.origin));

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    logger.warn("auth.callback_failed", { error: error?.message });
    return NextResponse.redirect(new URL("/login?error=auth", url.origin));
  }

  // The invite created the users row keyed by email; bind it to the auth id the
  // first time the person actually signs in.
  const existing = await repo.getUserByEmail(data.user.email);
  if (!existing) {
    logger.warn("auth.callback_no_account", { user_id: data.user.id });
    return NextResponse.redirect(new URL("/login?error=no_account", url.origin));
  }
  if (existing.id !== data.user.id) {
    await repo.bindAuthUserId(data.user.email, data.user.id);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
