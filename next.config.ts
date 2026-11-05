import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs is a Node library used only in server code (import pipeline).
  serverExternalPackages: ["exceljs", "@electric-sql/pglite", "pg"],
  outputFileTracingIncludes: {
    "/*": ["./supabase/migrations/**/*"],
  },
  experimental: {
    serverActions: {
      // Receipts and spreadsheets are uploaded through server actions.
      bodySizeLimit: "15mb",
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
