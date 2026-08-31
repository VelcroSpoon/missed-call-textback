import { SettingsForm } from "@/components/dashboard/settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone } from "@/lib/phone";
import { requireSession } from "@/server/auth";
import { saveSettings } from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { client } = await requireSession();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          How calls are handled for {client.name}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your tracking number</CardTitle>
          <CardDescription>
            Forward the business line to this number. It cannot be changed here — contact support
            if you need a different one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-lg tabular-nums">{formatPhone(client.twilioNumber)}</p>
        </CardContent>
      </Card>

      <SettingsForm
        action={saveSettings}
        initial={{
          businessPhone: client.businessPhone,
          dialTimeoutSeconds: client.dialTimeoutSeconds,
          quietHoursEnabled: client.quietHoursEnabled,
          quietHoursStart: client.quietHoursStart,
          quietHoursEnd: client.quietHoursEnd,
          timezone: client.timezone,
        }}
      />
    </div>
  );
}
