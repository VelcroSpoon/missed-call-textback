import Link from "next/link";
import { StatefulForm } from "@/components/dashboard/stateful-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPhone } from "@/lib/phone";
import { webhooksFor } from "@/lib/webhooks";
import { signOut } from "@/app/login/actions";
import { requireOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import {
  createClientAction,
  inviteUserAction,
  provisionNumberAction,
  syncWebhooksAction,
  toggleClientActiveAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireOwner();
  const clients = await repo.listClients();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <span className="font-semibold">Admin</span>
            <Link
              href="/dashboard"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to dashboard
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.email}</span>
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Clients</CardTitle>
            <CardDescription>{clients.length} tenant(s) on this deployment.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Tracking number</TableHead>
                  <TableHead>Forwards to</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Number setup</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => {
                  const pending = client.twilioNumber.startsWith("pending:");
                  return (
                    <TableRow key={client.id}>
                      <TableCell>
                        <div className="font-medium">{client.name}</div>
                        <div className="text-xs text-muted-foreground">{client.timezone}</div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {pending ? (
                          <span className="text-muted-foreground">Not provisioned</span>
                        ) : (
                          formatPhone(client.twilioNumber)
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatPhone(client.businessPhone)}
                      </TableCell>
                      <TableCell>
                        <form action={toggleClientActiveAction} className="flex items-center gap-2">
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="active" value={String(!client.active)} />
                          <Badge variant={client.active ? "success" : "secondary"}>
                            {client.active ? "Active" : "Paused"}
                          </Badge>
                          <Button type="submit" variant="ghost" size="sm">
                            {client.active ? "Pause" : "Activate"}
                          </Button>
                        </form>
                      </TableCell>
                      <TableCell>
                        {pending ? (
                          <StatefulForm
                            action={provisionNumberAction}
                            submitLabel="Provision"
                            pendingLabel="Buying…"
                            variant="outline"
                            size="sm"
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input type="hidden" name="clientId" value={client.id} />
                            <Input
                              name="areaCode"
                              placeholder="Area code"
                              inputMode="numeric"
                              className="h-9 w-28"
                              required
                            />
                          </StatefulForm>
                        ) : (
                          <StatefulForm
                            action={syncWebhooksAction}
                            submitLabel="Sync webhooks"
                            pendingLabel="Syncing…"
                            variant="outline"
                            size="sm"
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input type="hidden" name="clientId" value={client.id} />
                          </StatefulForm>
                        )}
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {webhooksFor(client.id).voiceUrl}
                        </p>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Add a client</CardTitle>
              <CardDescription>
                Leave the tracking number blank to provision one from the table above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StatefulForm action={createClientAction} submitLabel="Create client">
                <div className="space-y-2">
                  <Label htmlFor="name">Business name</Label>
                  <Input id="name" name="name" required placeholder="Demo Plumbing Co" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessPhone">Business phone (forwards here)</Label>
                  <Input
                    id="businessPhone"
                    name="businessPhone"
                    type="tel"
                    required
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="twilioNumber">Tracking number (optional)</Label>
                    <Input id="twilioNumber" name="twilioNumber" type="tel" placeholder="+1..." />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Input
                      id="timezone"
                      name="timezone"
                      defaultValue="America/New_York"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dialTimeoutSeconds">Dial timeout (seconds)</Label>
                  <Input
                    id="dialTimeoutSeconds"
                    name="dialTimeoutSeconds"
                    type="number"
                    min={5}
                    max={600}
                    defaultValue={20}
                    className="max-w-28"
                  />
                </div>
              </StatefulForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invite a user</CardTitle>
              <CardDescription>
                Sends a Supabase magic-link invite and binds the account to one client.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StatefulForm action={inviteUserAction} submitLabel="Send invite">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientId">Client</Label>
                  <select
                    id="clientId"
                    name="clientId"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <select
                    id="role"
                    name="role"
                    defaultValue="admin"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="admin">admin — dashboard only</option>
                    <option value="owner">owner — dashboard + admin</option>
                  </select>
                </div>
              </StatefulForm>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
