"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export interface ActionState {
  ok: boolean;
  message: string;
}

const EMPTY: ActionState = { ok: false, message: "" };

function SubmitButton({
  label,
  pendingLabel,
  variant,
  size,
}: {
  label: string;
  pendingLabel: string;
  variant?: "outline" | "secondary" | "destructive";
  size?: "sm";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Thin wrapper around useActionState so the admin screens can stay server
 * components apart from the form shells themselves.
 */
export function StatefulForm({
  action,
  submitLabel,
  pendingLabel = "Working…",
  variant,
  size,
  className,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "outline" | "secondary" | "destructive";
  size?: "sm";
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, EMPTY);

  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          label={submitLabel}
          pendingLabel={pendingLabel}
          variant={variant}
          size={size}
        />
        {state.message ? (
          <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
