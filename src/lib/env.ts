/**
 * Env access. Everything is read lazily so that importing a module never
 * throws at build time — only the code path that actually needs a variable
 * fails, and it fails loudly.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get appUrl(): string {
    const raw =
      process.env.APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
    if (!raw) throw new Error("Missing required environment variable: APP_URL");
    return raw.replace(/\/+$/, "");
  },
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get twilioAccountSid(): string {
    return required("TWILIO_ACCOUNT_SID");
  },
  get twilioAuthToken(): string {
    return required("TWILIO_AUTH_TOKEN");
  },
  get twilioApiKeySid(): string | undefined {
    return process.env.TWILIO_API_KEY_SID || undefined;
  },
  get twilioApiKeySecret(): string | undefined {
    return process.env.TWILIO_API_KEY_SECRET || undefined;
  },
  get twilioMessagingServiceSid(): string | undefined {
    return process.env.TWILIO_MESSAGING_SERVICE_SID || undefined;
  },
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey(): string {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey(): string {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  /**
   * Escape hatch for local development only. Hard-disabled in production so a
   * stray env var can never open the webhooks up on a live deployment.
   */
  get skipSignatureValidation(): boolean {
    if (process.env.NODE_ENV === "production") return false;
    return process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === "true";
  },
};

/** Absolute URL for a webhook path, e.g. webhookUrl("/api/sms/status"). */
export function webhookUrl(path: string): string {
  return `${env.appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
