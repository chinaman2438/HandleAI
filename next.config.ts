import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs is a Node library used only in server code (import pipeline).
  serverExternalPackages: ["exceljs", "@electric-sql/pglite", "pg"],
  outputFileTracingIncludes: {
    "/*": ["./supabase/migrations/**/*"],
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || "",
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
