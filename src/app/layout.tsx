import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Missed Call Text-Back",
  description: "Never lose a lead to an unanswered phone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
