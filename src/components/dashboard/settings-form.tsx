"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ActionState } from "@/app/dashboard/actions";

const EMPTY: ActionState = { ok: false, message: "" };

export interface SettingsValues {
  businessPhone: string;
  dialTimeoutSeconds: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save settings"}
    </Button>
  );
}

export function SettingsForm({
  initial,
  action,
}: {
  initial: SettingsValues;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, EMPTY);
  const [quietEnabled, setQuietEnabled] = useState(initial.quietHoursEnabled);

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Call handling</CardTitle>
          <CardDescription>Where we send the call, and how long we let it ring.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="businessPhone">Business phone</Label>
            <Input
              id="businessPhone"
              name="businessPhone"
              type="tel"
              defaultValue={initial.businessPhone}
              required
            />
            <p className="text-xs text-muted-foreground">
              The real line we bridge callers to. Not the tracking number.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dialTimeoutSeconds">Ring time before we call it missed</Label>
            <div className="flex items-center gap-2">
              <Input
                id="dialTimeoutSeconds"
                name="dialTimeoutSeconds"
                type="number"
                min={5}
                max={600}
                defaultValue={initial.dialTimeoutSeconds}
                required
                className="max-w-28"
              />
              <span className="text-sm text-muted-foreground">seconds</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Keep this below the carrier voicemail pickup, or voicemail answers first and the
              call never counts as missed.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
          <CardDescription>
            Missed calls inside this window are logged, but no text goes out. Nothing is queued for
            later — a 2am text about a 2am call is worse than none.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <Switch
              id="quietHoursEnabled"
              name="quietHoursEnabled"
              checked={quietEnabled}
              onCheckedChange={setQuietEnabled}
            />
            <Label htmlFor="quietHoursEnabled">Enable quiet hours</Label>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="quietHoursStart">Start</Label>
              <Input
                id="quietHoursStart"
                name="quietHoursStart"
                type="time"
                defaultValue={initial.quietHoursStart}
                className={quietEnabled ? undefined : "opacity-50"}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quietHoursEnd">End</Label>
              <Input
                id="quietHoursEnd"
                name="quietHoursEnd"
                type="time"
                defaultValue={initial.quietHoursEnd}
                className={quietEnabled ? undefined : "opacity-50"}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                name="timezone"
                defaultValue={initial.timezone}
                placeholder="America/New_York"
                required
              />
              <p className="text-xs text-muted-foreground">IANA name.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <SaveButton />
        {state.message ? (
          <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
