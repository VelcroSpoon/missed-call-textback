/**
 * Seed one demo client so the whole flow can be exercised against a single
 * phone number.
 *
 *   npm run seed
 *
 * Idempotent: re-running updates the demo client rather than creating another.
 * Reads SEED_* from .env — see .env.example.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { clients, templates, users } from "../src/db/schema";
import { normalizePhone } from "../src/lib/phone";
import { DEFAULT_TEMPLATE_BODY } from "../src/lib/templates";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill in the SEED_* values.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const name = process.env.SEED_CLIENT_NAME ?? "Demo Plumbing Co";
  const businessPhone = normalizePhone(requireEnv("SEED_BUSINESS_PHONE"));
  const twilioNumber = normalizePhone(requireEnv("SEED_TWILIO_NUMBER"));
  const timezone = process.env.SEED_TIMEZONE ?? "America/New_York";
  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();

  if (!businessPhone || !twilioNumber) {
    console.error("SEED_BUSINESS_PHONE and SEED_TWILIO_NUMBER must be valid phone numbers.");
    process.exit(1);
  }
  if (businessPhone === twilioNumber) {
    console.error(
      "SEED_BUSINESS_PHONE and SEED_TWILIO_NUMBER must differ — a number cannot forward to itself.",
    );
    process.exit(1);
  }

  const existing = await db
    .select()
    .from(clients)
    .where(eq(clients.twilioNumber, twilioNumber))
    .limit(1);

  let clientId: string;
  if (existing[0]) {
    clientId = existing[0].id;
    await db
      .update(clients)
      .set({ name, businessPhone, timezone, active: true })
      .where(eq(clients.id, clientId));
    console.log(`Updated existing client ${name} (${clientId})`);
  } else {
    const inserted = await db
      .insert(clients)
      .values({
        name,
        businessPhone,
        twilioNumber,
        timezone,
        dialTimeoutSeconds: 20,
        quietHoursEnabled: true,
        quietHoursStart: "21:00",
        quietHoursEnd: "08:00",
        active: true,
      })
      .returning();
    clientId = inserted[0].id;
    console.log(`Created client ${name} (${clientId})`);
  }

  const existingTemplate = await db
    .select()
    .from(templates)
    .where(eq(templates.clientId, clientId))
    .limit(1);

  if (!existingTemplate[0]) {
    await db.insert(templates).values({
      clientId,
      body: DEFAULT_TEMPLATE_BODY,
      isDefault: true,
    });
    console.log("Created default template");
  } else {
    console.log("Template already present, leaving it alone");
  }

  if (ownerEmail) {
    // Placeholder id — rebound to the real Supabase auth id on first sign-in.
    await db
      .insert(users)
      .values({ id: randomUUID(), email: ownerEmail, clientId, role: "owner" })
      .onConflictDoUpdate({ target: users.email, set: { clientId, role: "owner" } });
    console.log(`Owner account: ${ownerEmail}`);
    console.log(
      "  Invite them in Supabase Auth (or from /admin) so the magic link works.",
    );
  }

  const appUrl = (process.env.APP_URL ?? "https://YOUR-NGROK-URL").replace(/\/+$/, "");
  console.log("");
  console.log("Point the Twilio number at these URLs (Console > Phone Numbers > your number):");
  console.log(`  A call comes in   POST  ${appUrl}/api/voice/${clientId}`);
  console.log(`  A message comes in POST ${appUrl}/api/sms/incoming/${clientId}`);
  console.log("");
  console.log("Then call the Twilio number from another phone, let it ring past the timeout,");
  console.log("and the caller should receive the text-back.");
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
