"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { webhookUrl } from "@/lib/env";
import { webhooksFor } from "@/lib/webhooks";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { createAdminSupabase } from "@/lib/supabase/server";
import { DEFAULT_TEMPLATE_BODY } from "@/lib/templates";
import { twilioClient } from "@/lib/twilio";
import { requireOwner } from "@/server/auth";
import * as repo from "@/server/repo";

export interface ActionState {
  ok: boolean;
  message: string;
}

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  businessPhone: z.string().min(1, "Business phone is required"),
  twilioNumber: z.string().optional(),
  timezone: z.string().min(1),
  dialTimeoutSeconds: z.coerce.number().int().min(5).max(600).default(20),
});

export async function createClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const parsed = createClientSchema.safeParse({
    name: formData.get("name"),
    businessPhone: formData.get("businessPhone"),
    twilioNumber: formData.get("twilioNumber") || undefined,
    timezone: formData.get("timezone") || "America/New_York",
    dialTimeoutSeconds: formData.get("dialTimeoutSeconds") || 20,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const businessPhone = normalizePhone(parsed.data.businessPhone);
  if (!businessPhone) return { ok: false, message: "Invalid business phone number." };

  // A tracking number can be attached now or provisioned afterwards. Until one
  // exists the client has no inbound path, so we park it on a placeholder that
  // can never collide with a real E.164 number.
  const twilioNumber = parsed.data.twilioNumber
    ? normalizePhone(parsed.data.twilioNumber)
    : `pending:${crypto.randomUUID()}`;
  if (!twilioNumber) return { ok: false, message: "Invalid Twilio number." };

  try {
    const client = await repo.createClient({
      name: parsed.data.name,
      businessPhone,
      twilioNumber,
      timezone: parsed.data.timezone,
      dialTimeoutSeconds: parsed.data.dialTimeoutSeconds,
    });

    // Every client starts with a working default template so a missed call is
    // never dropped for want of configuration.
    await repo.upsertDefaultTemplate(client.id, DEFAULT_TEMPLATE_BODY);

    logger.info("admin.client_created", { client_id: client.id });
    revalidatePath("/admin");
    return { ok: true, message: `Created ${client.name}.` };
  } catch (error) {
    logger.error("admin.client_create_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: "Could not create the client. Is that number already in use?" };
  }
}

const provisionSchema = z.object({
  clientId: z.string().uuid(),
  areaCode: z.string().regex(/^\d{3}$/, "Area code must be 3 digits"),
});

/**
 * Search for an available local number, buy it, and point it at this tenant's
 * webhooks in the same API call.
 */
export async function provisionNumberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const parsed = provisionSchema.safeParse({
    clientId: formData.get("clientId"),
    areaCode: formData.get("areaCode"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const client = await repo.getClientById(parsed.data.clientId);
  if (!client) return { ok: false, message: "Unknown client." };

  const { voiceUrl, smsUrl } = webhooksFor(client.id);

  try {
    const available = await twilioClient()
      .availablePhoneNumbers("US")
      .local.list({
        areaCode: Number(parsed.data.areaCode),
        smsEnabled: true,
        voiceEnabled: true,
        limit: 1,
      });

    if (available.length === 0) {
      return { ok: false, message: `No numbers available in area code ${parsed.data.areaCode}.` };
    }

    const purchased = await twilioClient().incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      friendlyName: `${client.name} (missed-call text-back)`,
      voiceUrl,
      voiceMethod: "POST",
      smsUrl,
      smsMethod: "POST",
    });

    await repo.updateClient(client.id, {
      twilioNumber: purchased.phoneNumber,
      twilioNumberSid: purchased.sid,
    });

    logger.info("admin.number_provisioned", {
      client_id: client.id,
      number_sid: purchased.sid,
    });
    revalidatePath("/admin");
    return { ok: true, message: `Provisioned ${purchased.phoneNumber} and set its webhooks.` };
  } catch (error) {
    logger.error("admin.provision_failed", {
      client_id: client.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: error instanceof Error ? `Twilio: ${error.message}` : "Provisioning failed.",
    };
  }
}

/**
 * Re-point an already-owned number at this deployment. Use after changing
 * APP_URL, or when attaching a number bought outside the app.
 */
export async function syncWebhooksAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const clientId = String(formData.get("clientId") ?? "");
  const client = await repo.getClientById(clientId);
  if (!client) return { ok: false, message: "Unknown client." };
  if (client.twilioNumber.startsWith("pending:")) {
    return { ok: false, message: "This client has no Twilio number yet." };
  }

  const { voiceUrl, smsUrl } = webhooksFor(client.id);

  try {
    let sid = client.twilioNumberSid;
    if (!sid) {
      const found = await twilioClient().incomingPhoneNumbers.list({
        phoneNumber: client.twilioNumber,
        limit: 1,
      });
      if (found.length === 0) {
        return { ok: false, message: "That number is not owned by this Twilio account." };
      }
      sid = found[0].sid;
    }

    await twilioClient()
      .incomingPhoneNumbers(sid)
      .update({ voiceUrl, voiceMethod: "POST", smsUrl, smsMethod: "POST" });

    await repo.updateClient(client.id, { twilioNumberSid: sid });

    logger.info("admin.webhooks_synced", { client_id: client.id, number_sid: sid });
    revalidatePath("/admin");
    return { ok: true, message: "Webhooks updated on the Twilio number." };
  } catch (error) {
    logger.error("admin.webhook_sync_failed", {
      client_id: client.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: error instanceof Error ? `Twilio: ${error.message}` : "Sync failed.",
    };
  }
}

export async function toggleClientActiveAction(formData: FormData) {
  await requireOwner();
  const clientId = String(formData.get("clientId") ?? "");
  const active = formData.get("active") === "true";
  await repo.updateClient(clientId, { active });
  logger.info("admin.client_toggled", { client_id: clientId, active });
  revalidatePath("/admin");
}

const inviteSchema = z.object({
  email: z.string().email(),
  clientId: z.string().uuid(),
  role: z.enum(["owner", "admin"]),
});

/** Invite a user to a tenant. Creates the Supabase auth user and our row. */
export async function inviteUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const parsed = inviteSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    clientId: formData.get("clientId"),
    role: formData.get("role") ?? "admin",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo: webhookUrl("/auth/callback"),
    });

    // An already-invited address is not an error worth failing on — we still
    // want our users row to exist and point at the right client.
    const authUserId = data?.user?.id ?? crypto.randomUUID();
    if (error && !/already/i.test(error.message)) {
      return { ok: false, message: `Invite failed: ${error.message}` };
    }

    await repo.createUser({
      id: authUserId,
      email: parsed.data.email,
      clientId: parsed.data.clientId,
      role: parsed.data.role,
    });

    logger.info("admin.user_invited", { client_id: parsed.data.clientId, role: parsed.data.role });
    revalidatePath("/admin");
    return { ok: true, message: `Invited ${parsed.data.email}.` };
  } catch (error) {
    logger.error("admin.invite_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: "Invite failed." };
  }
}
