import Link from "next/link";
import { PhoneMissed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { requireSession } from "@/server/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <PhoneMissed className="h-5 w-5" />
              <span>{session.client.name}</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Overview
              </Link>
              <Link
                href="/dashboard/templates"
                className="rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Template
              </Link>
              <Link
                href="/dashboard/settings"
                className="rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Settings
              </Link>
              {session.user.role === "owner" ? (
                <Link
                  href="/admin"
                  className="rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Admin
                </Link>
              ) : null}
            </nav>
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
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
