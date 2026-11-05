import { NextResponse } from "next/server";
import { getServiceDb } from "@/lib/db/engine";
import { generateUpcomingReminders } from "@/lib/reminders/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized cron invocation" }, { status: 401 });
  }

  const db = await getServiceDb();
  const summary = await generateUpcomingReminders(db);

  return NextResponse.json({
    ok: true,
    ...summary,
  });
}
