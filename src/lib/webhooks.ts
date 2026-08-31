import { webhookUrl } from "./env";

/**
 * The Twilio webhook URLs for one tenant. Shared by the admin UI (to display
 * and to sync them onto the number) and by the seed script.
 */
export function webhooksFor(clientId: string) {
  return {
    voiceUrl: webhookUrl(`/api/voice/${clientId}`),
    smsUrl: webhookUrl(`/api/sms/incoming/${clientId}`),
  };
}
