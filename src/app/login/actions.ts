"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email) redirect("/login?error=auth");

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${env.appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      // Accounts are created by an owner in /admin, not by whoever types an
      // address into this form.
      shouldCreateUser: false,
    },
  });

  if (error) {
    logger.warn("auth.magic_link_failed", { error: error.message });
    // Deliberately vague: do not leak whether an address has an account.
  }

  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
