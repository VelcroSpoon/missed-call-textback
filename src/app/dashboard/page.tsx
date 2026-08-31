import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPhone } from "@/lib/phone";
import { SUPPRESSION_LABELS, type SuppressionReason } from "@/lib/suppression";
import { formatInZone } from "@/lib/tz";
import { requireSession } from "@/server/auth";
import { getHeadlineMetrics, getRecentMissedCalls, getRecoveryMetrics } from "@/server/metrics";

export const dynamic = "force-dynamic";

function suppressionLabel(reason: string | null): string {
  if (!reason) return "Not sent";
  return SUPPRESSION_LABELS[reason as SuppressionReason | "send_failed"] ?? reason;
}

export default async function DashboardPage() {
  const { client } = await requireSession();

  const [headline, recovery, recent] = await Promise.all([
    getHeadlineMetrics(client.id, client.timezone),
    getRecoveryMetrics(client.id, client.timezone),
    getRecentMissedCalls(client.id, 50),
  ]);

  const change = headline.percentChange;
  const ChangeIcon = change === null ? Minus : change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  // More missed calls is bad news, so an increase is coloured as a warning.
  const changeTone =
    change === null || change === 0
      ? "text-muted-foreground"
      : change > 0
        ? "text-amber-600"
        : "text-emerald-600";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Missed calls and text-back recovery for {client.name}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Missed calls · {headline.thisMonthLabel}</CardDescription>
            <CardTitle className="text-4xl tabular-nums">{headline.thisMonth}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`flex items-center gap-1.5 text-sm ${changeTone}`}>
              <ChangeIcon className="h-4 w-4" />
              <span className="font-medium">
                {change === null ? "No prior month" : `${change > 0 ? "+" : ""}${change.toFixed(0)}%`}
              </span>
              <span className="text-muted-foreground">vs {headline.lastMonthLabel}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Missed calls · {headline.lastMonthLabel}</CardDescription>
            <CardTitle className="text-4xl tabular-nums">{headline.lastMonth}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Full previous calendar month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recovery rate · this month</CardDescription>
            <CardTitle className="text-4xl tabular-nums">
              {recovery.rate === null ? "—" : `${recovery.rate.toFixed(0)}%`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {recovery.replied} of {recovery.missedWithSms} texted callers replied
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent missed calls</CardTitle>
          <CardDescription>Times shown in {client.timezone}.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {recent.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No missed calls recorded yet. Once the business forwards its line to{" "}
              {formatPhone(client.twilioNumber)}, they will show up here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Caller</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Text sent</TableHead>
                  <TableHead>Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatInZone(row.createdAt, client.timezone)}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {formatPhone(row.fromNumber)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.status}</TableCell>
                    <TableCell>
                      {row.smsSent ? (
                        <Badge variant="success">Sent</Badge>
                      ) : (
                        <Badge variant="warning">{suppressionLabel(row.suppressionReason)}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.replied ? (
                        <Badge variant="success">Replied</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
