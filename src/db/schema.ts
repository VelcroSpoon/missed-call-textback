import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const messageDirection = pgEnum("message_direction", ["outbound", "inbound"]);
export const userRole = pgEnum("user_role", ["owner", "admin"]);

/**
 * A tenant. One small business, one Twilio number.
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** The business's real line. This is what we <Dial>. E.164. */
    businessPhone: text("business_phone").notNull(),
    /** The number we own and that the business forwards to. E.164. */
    twilioNumber: text("twilio_number").notNull(),
    twilioNumberSid: text("twilio_number_sid"),
    /** IANA tz, e.g. America/New_York. Drives quiet hours. */
    timezone: text("timezone").notNull().default("America/New_York"),
    dialTimeoutSeconds: integer("dial_timeout_seconds").notNull().default(20),
    /** Quiet hours: suppress outbound SMS inside this local-time window. */
    quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(true),
    /** "HH:MM" 24h, in the client's timezone. The window may wrap midnight. */
    quietHoursStart: text("quiet_hours_start").notNull().default("21:00"),
    quietHoursEnd: text("quiet_hours_end").notNull().default("08:00"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clients_twilio_number_idx").on(t.twilioNumber),
    index("clients_active_idx").on(t.active),
  ],
);

/**
 * Static message templates. No LLM anywhere near this.
 * Placeholders: {{business_name}}, {{caller_number}}.
 */
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("templates_client_id_idx").on(t.clientId, t.isDefault)],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Parent CallSid. The idempotency key for status callbacks. */
    twilioCallSid: text("twilio_call_sid").notNull(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    /** Raw DialCallStatus: completed | no-answer | busy | failed | canceled. */
    status: text("status").notNull(),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    missed: boolean("missed").notNull().default(false),
    /** True when the call was missed but we deliberately did not text back. */
    suppressed: boolean("suppressed").notNull().default(false),
    /** opted_out | quiet_hours | not_mobile | no_template | inactive_client | send_failed */
    suppressionReason: text("suppression_reason"),
    smsSent: boolean("sms_sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("calls_twilio_call_sid_idx").on(t.twilioCallSid),
    index("calls_client_id_created_at_idx").on(t.clientId, t.createdAt),
    index("calls_client_from_missed_idx").on(t.clientId, t.fromNumber, t.missed),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    body: text("body").notNull(),
    twilioMessageSid: text("twilio_message_sid"),
    /** queued | sent | delivered | undelivered | failed | received */
    status: text("status"),
    errorCode: integer("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_twilio_message_sid_idx").on(t.twilioMessageSid),
    index("messages_client_id_created_at_idx").on(t.clientId, t.createdAt),
    index("messages_call_id_idx").on(t.callId),
  ],
);

export const optOuts = pgTable(
  "opt_outs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("opt_outs_client_id_phone_number_idx").on(t.clientId, t.phoneNumber)],
);

export const users = pgTable(
  "users",
  {
    /** Mirrors the Supabase auth.users id. */
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    role: userRole("role").notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    index("users_client_id_idx").on(t.clientId),
  ],
);

/**
 * Cache of Twilio Lookup line-type results. Lookups are billed per request and
 * a number's line type effectively never changes, so this cache is global
 * (not per-tenant) and long-lived.
 */
export const phoneLookups = pgTable(
  "phone_lookups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneNumber: text("phone_number").notNull(),
    /** null = lookup failed or indeterminate; we fail open and still send. */
    isMobile: boolean("is_mobile"),
    lineType: text("line_type"),
    carrier: text("carrier"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("phone_lookups_phone_number_idx").on(t.phoneNumber)],
);

export const clientsRelations = relations(clients, ({ many }) => ({
  templates: many(templates),
  calls: many(calls),
  messages: many(messages),
  optOuts: many(optOuts),
  users: many(users),
}));

export const callsRelations = relations(calls, ({ one, many }) => ({
  client: one(clients, { fields: [calls.clientId], references: [clients.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  client: one(clients, { fields: [messages.clientId], references: [clients.id] }),
  call: one(calls, { fields: [messages.callId], references: [calls.id] }),
}));

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type OptOut = typeof optOuts.$inferSelect;
export type User = typeof users.$inferSelect;
export type PhoneLookup = typeof phoneLookups.$inferSelect;
