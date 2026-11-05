import path from "node:path";
import dotenv from "dotenv";
import { getServiceDb } from "../src/lib/db/engine";
import { generateUpcomingReminders } from "../src/lib/reminders/service";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  const db = await getServiceDb();
  const result = await generateUpcomingReminders(db);
  console.log("[reminders:run] Reminder run summary:", result);
}

main().catch((err) => {
  console.error("[reminders:run] Failed:", err);
  process.exit(1);
});
