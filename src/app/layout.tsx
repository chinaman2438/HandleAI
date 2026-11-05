import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meridian Receivables Portal | Meridian Insurance Brokers",
  description:
    "Enterprise Receivables Management, Policy Installment Tracking, Insurer Verification & Analytics for Meridian Insurance Brokers (Brazil).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
