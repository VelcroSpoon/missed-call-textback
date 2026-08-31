import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendMagicLink } from "./actions";

const ERROR_COPY: Record<string, string> = {
  no_account: "That email is not attached to any account. Ask your administrator for an invite.",
  no_client: "Your account is not linked to a business yet. Contact support.",
  auth: "That sign-in link was invalid or has expired. Request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error ? (ERROR_COPY[params.error] ?? null) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            We will email you a magic link. No password to remember.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {params.sent ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Check your inbox. The link is good for one hour.
            </div>
          ) : (
            <form action={sendMagicLink} className="space-y-4">
              <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@yourbusiness.com"
                />
              </div>
              {errorMessage ? (
                <p className="text-sm text-destructive">{errorMessage}</p>
              ) : null}
              <Button type="submit" className="w-full">
                Email me a link
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
