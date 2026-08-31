/** Deterministic env for every test file. */
process.env.APP_URL = "https://example.test";
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
// Keep the suite output readable; raise to "debug" when diagnosing a webhook.
process.env.LOG_LEVEL = "error";

// The dev-only bypass must never be on while tests run — several tests assert
// that a bad signature is rejected.
delete process.env.TWILIO_SKIP_SIGNATURE_VALIDATION;
