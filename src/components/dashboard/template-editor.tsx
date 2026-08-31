"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildMessageBody, estimateSegments, OPT_OUT_NOTICE } from "@/lib/templates";
import type { ActionState } from "@/app/dashboard/actions";

const EMPTY: ActionState = { ok: false, message: "" };

function SubmitButton({ children, variant }: { children: React.ReactNode; variant?: "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

function Status({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
      {state.message}
    </p>
  );
}

export function TemplateEditor({
  initialBody,
  businessName,
  saveAction,
  testAction,
}: {
  initialBody: string;
  businessName: string;
  saveAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  testAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [body, setBody] = useState(initialBody);
  const [saveState, saveFormAction] = useActionState(saveAction, EMPTY);
  const [testState, testFormAction] = useActionState(testAction, EMPTY);

  // The preview renders exactly what the webhook would send, including the
  // appended opt-out notice, so what you see here is what the caller gets.
  const preview = buildMessageBody(body, {
    business_name: businessName,
    caller_number: "+15551234567",
  });
  const { encoding, segments } = estimateSegments(preview);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Message template</CardTitle>
          <CardDescription>
            Placeholders: <code className="font-mono">{"{{business_name}}"}</code> and{" "}
            <code className="font-mono">{"{{caller_number}}"}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={saveFormAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="body">Text sent after a missed call</Label>
              <Textarea
                id="body"
                name="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                required
              />
              <p className="text-xs text-muted-foreground">
                &ldquo;{OPT_OUT_NOTICE}&rdquo; is appended automatically — you do not need to type
                it.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <SubmitButton>Save template</SubmitButton>
              <Status state={saveState} />
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>
              {segments} segment{segments === 1 ? "" : "s"} · {encoding} · {preview.length}{" "}
              characters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm rounded-2xl rounded-bl-sm bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
              {preview}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Send a test</CardTitle>
            <CardDescription>
              Sends the message above from your Twilio number, right now. Standard rates apply.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={testFormAction} className="space-y-4">
              <input type="hidden" name="body" value={body} />
              <div className="space-y-2">
                <Label htmlFor="to">Your mobile number</Label>
                <Input id="to" name="to" type="tel" placeholder="(555) 123-4567" required />
              </div>
              <div className="flex items-center gap-3">
                <SubmitButton variant="outline">Send test to my phone</SubmitButton>
              </div>
              <Status state={testState} />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
