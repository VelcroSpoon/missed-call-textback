import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  calls,
  clients,
  messages,
  optOuts,
  phoneLookups,
  templates,
  users,
  type Call,
  type Client,
  type NewCall,
  type NewClient,
  type Template,
} from "@/db/schema";

/**
 * All database access used by the webhook path lives here.
 *
 * Two reasons: the webhooks stay readable, and the tests can mock this one
 * module instead of stubbing a Drizzle query builder.
 */

export async function getClientById(clientId: string): Promise<Client | null> {
  const rows = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  return rows[0] ?? null;
}

export async function getClientByTwilioNumber(number: string): Promise<Client | null> {
  const rows = await db.select().from(clients).where(eq(clients.twilioNumber, number)).limit(1);
  return rows[0] ?? null;
}

export async function listClients(): Promise<Client[]> {
  return db.select().from(clients).orderBy(desc(clients.createdAt));
}

export async function createClient(values: Omit<NewClient, "id" | "createdAt">) {
  const rows = await db.insert(clients).values(values).returning();
  return rows[0];
}

export async function updateClient(
  clientId: string,
  values: Partial<Omit<NewClient, "id" | "createdAt">>,
) {
  const rows = await db.update(clients).set(values).where(eq(clients.id, clientId)).returning();
  return rows[0] ?? null;
}

/**
 * The idempotency gate.
 *
 * `twilio_call_sid` is unique, so a retried status callback conflicts and we
 * return null — telling the caller "someone already handled this CallSid, do
 * not send again". This is a single atomic statement on purpose: two
 * concurrent retries cannot both win.
 */
export async function insertCallIfNew(values: Omit<NewCall, "id" | "createdAt">): Promise<Call | null> {
  const rows = await db
    .insert(calls)
    .values(values)
    .onConflictDoNothing({ target: calls.twilioCallSid })
    .returning();
  return rows[0] ?? null;
}

export async function updateCallById(callId: string, values: Partial<Call>) {
  await db.update(calls).set(values).where(eq(calls.id, callId));
}

export async function updateCallBySid(twilioCallSid: string, values: Partial<Call>) {
  await db.update(calls).set(values).where(eq(calls.twilioCallSid, twilioCallSid));
}

export async function isOptedOut(clientId: string, phoneNumber: string): Promise<boolean> {
  const rows = await db
    .select({ id: optOuts.id })
    .from(optOuts)
    .where(and(eq(optOuts.clientId, clientId), eq(optOuts.phoneNumber, phoneNumber)))
    .limit(1);
  return rows.length > 0;
}

export async function addOptOut(clientId: string, phoneNumber: string) {
  await db
    .insert(optOuts)
    .values({ clientId, phoneNumber })
    .onConflictDoNothing({ target: [optOuts.clientId, optOuts.phoneNumber] });
}

export async function removeOptOut(clientId: string, phoneNumber: string) {
  await db
    .delete(optOuts)
    .where(and(eq(optOuts.clientId, clientId), eq(optOuts.phoneNumber, phoneNumber)));
}

export async function getDefaultTemplate(clientId: string): Promise<Template | null> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.clientId, clientId), eq(templates.isDefault, true)))
    .limit(1);
  if (rows[0]) return rows[0];

  // Fall back to any template the client has, newest first.
  const fallback = await db
    .select()
    .from(templates)
    .where(eq(templates.clientId, clientId))
    .orderBy(desc(templates.createdAt))
    .limit(1);
  return fallback[0] ?? null;
}

export async function upsertDefaultTemplate(clientId: string, body: string) {
  const existing = await db
    .select()
    .from(templates)
    .where(and(eq(templates.clientId, clientId), eq(templates.isDefault, true)))
    .limit(1);

  if (existing[0]) {
    await db.update(templates).set({ body }).where(eq(templates.id, existing[0].id));
    return existing[0].id;
  }
  const rows = await db.insert(templates).values({ clientId, body, isDefault: true }).returning();
  return rows[0].id;
}

export async function insertMessage(values: {
  callId?: string | null;
  clientId: string;
  direction: "outbound" | "inbound";
  body: string;
  twilioMessageSid?: string | null;
  status?: string | null;
  errorCode?: number | null;
}) {
  const rows = await db
    .insert(messages)
    .values(values)
    .onConflictDoNothing({ target: messages.twilioMessageSid })
    .returning();
  return rows[0] ?? null;
}

export async function updateMessageStatus(
  twilioMessageSid: string,
  status: string,
  errorCode: number | null,
) {
  const rows = await db
    .update(messages)
    .set({ status, errorCode })
    .where(eq(messages.twilioMessageSid, twilioMessageSid))
    .returning({ id: messages.id });
  return rows[0] ?? null;
}

export async function getCachedLookup(phoneNumber: string) {
  const rows = await db
    .select()
    .from(phoneLookups)
    .where(eq(phoneLookups.phoneNumber, phoneNumber))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveLookup(values: {
  phoneNumber: string;
  isMobile: boolean | null;
  lineType: string | null;
  carrier: string | null;
}) {
  await db
    .insert(phoneLookups)
    .values(values)
    .onConflictDoUpdate({
      target: phoneLookups.phoneNumber,
      set: {
        isMobile: values.isMobile,
        lineType: values.lineType,
        carrier: values.carrier,
        checkedAt: new Date(),
      },
    });
}

/**
 * The most recent missed call from this caller, used to attribute an inbound
 * reply back to the call that triggered it (that attribution is the recovery
 * rate). Bounded to 7 days so an unrelated text months later is not counted.
 */
export async function findRecentMissedCall(
  clientId: string,
  fromNumber: string,
): Promise<Call | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.clientId, clientId),
        eq(calls.fromNumber, fromNumber),
        eq(calls.missed, true),
        gte(calls.createdAt, since),
      ),
    )
    .orderBy(desc(calls.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(values: {
  id: string;
  email: string;
  clientId: string | null;
  role?: "owner" | "admin";
}) {
  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.email,
      set: { clientId: values.clientId, role: values.role ?? "admin" },
    });
}

/**
 * Point an existing users row at the Supabase auth id.
 *
 * Invited users are created with a placeholder id (we do not know their auth id
 * until they click the magic link), so the first successful sign-in rebinds the
 * row. Nothing references users.id by FK, so moving the PK is safe.
 */
export async function bindAuthUserId(email: string, authUserId: string) {
  await db.update(users).set({ id: authUserId }).where(eq(users.email, email));
}
