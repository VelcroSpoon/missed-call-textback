"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { webhookUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { normalizePhone, redactPhone } from "@/lib/phone";
import { buildMessageBody } from "@/lib/templates";
import { sendSms } from "@/lib/twilio";
import { requireSession } from "@/server/auth";
import * as repo from "@/server/repo";

export interface ActionState {
  ok: boolean;
  message: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const settingsSchema = z.object({
  businessPhone: z.string().min(1, "Business phone is required"),
  dialTimeoutSeconds: z.coerce
    .number()
    .int()
    .min(5, "Timeout must be at least 5 seconds")
    .max(600, "Twilio caps the dial timeout at 600 seconds"),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(TIME_RE, "Use 24-hour HH:MM"),
  quietHoursEnd: z.string().regex(TIME_RE, "Use 24-hour HH:MM"),
  timezone: z.string().min(1),
});

export async function saveSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { client } = await requireSession();

  const parsed = settingsSchema.safeParse({
    businessPhone: formData.get("businessPhone"),
    dialTimeoutSeconds: formData.get("dialTimeoutSeconds"),
    quietHoursEnabled: formData.get("quietHoursEnabled") === "on",
    quietHoursStart: formData.get("quietHoursStart"),
    quietHoursEnd: formData.get("quietHoursEnd"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid settings" };
  }

  const businessPhone = normalizePhone(parsed.data.businessPhone);
  if (!businessPhone) {
    return { ok: false, message: "That business phone number is not a valid number." };
  }

  try {
    // Reject an unknown timezone here rather than discovering it at 9pm when
    // quiet hours silently stop working.
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
  } catch {
    return { ok: false, message: "Unrecognised timezone." };
  }

  await repo.updateClient(client.id, {
    businessPhone,
    dialTimeoutSeconds: parsed.data.dialTimeoutSeconds,
    quietHoursEnabled: parsed.data.quietHoursEnabled,
    quietHoursStart: parsed.data.quietHoursStart,
    quietHoursEnd: parsed.data.quietHoursEnd,
    timezone: parsed.data.timezone,
  });

  logger.info("settings.updated", { client_id: client.id });
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Settings saved." };
}

export async function saveTemplate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { client } = await requireSession();
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { ok: false, message: "The message cannot be empty." };
  if (body.length > 1200) {
    return { ok: false, message: "Keep the message under 1200 characters." };
  }

  await repo.upsertDefaultTemplate(client.id, body);
  logger.info("template.updated", { client_id: client.id });
  revalidatePath("/dashboard/templates");
  return { ok: true, message: "Template saved." };
}

export async function sendTestMessage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { client } = await requireSession();

  const to = normalizePhone(String(formData.get("to") ?? ""));
  const body = String(formData.get("body") ?? "").trim();

  if (!to) return { ok: false, message: "Enter a valid mobile number to test with." };
  if (!body) return { ok: false, message: "The message cannot be empty." };

  // A test send is still a real send. Honour opt-outs.
  if (await repo.isOptedOut(client.id, to)) {
    return { ok: false, message: "That number has opted out and cannot be texted." };
  }

  const rendered = buildMessageBody(body, {
    business_name: client.name,
    caller_number: to,
  });

  try {
    const message = await sendSms({
      to,
      from: client.twilioNumber,
      body: rendered,
      statusCallback: webhookUrl("/api/sms/status"),
    });

    await repo.insertMessage({
      callId: null,
      clientId: client.id,
      direction: "outbound",
      body: rendered,
      twilioMessageSid: message.sid,
      status: message.status ?? "queued",
    });

    logger.info("template.test_sent", { client_id: client.id, message_sid: message.sid });
    return { ok: true, message: `Test sent to ${redactPhone(to)}.` };
  } catch (error) {
    logger.error("template.test_failed", {
      client_id: client.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: error instanceof Error ? `Twilio rejected the send: ${error.message}` : "Send failed.",
    };
  }
}
