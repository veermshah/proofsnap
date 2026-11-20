import { LeanWorker } from "@/lib/lean";

export const maxDuration = 300;

// Health check for the Lean checker. Also used by the daily cron to keep the snapshot in use.
// GET /api/admin/lean?key=SECRET            -> boots the snapshot and checks a tiny proof
// GET /api/admin/lean?key=SECRET&resnapshot=1 -> also saves a never-expiring copy of the snapshot
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  const okCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const okKey = process.env.PROOFSNAP_ADMIN_SECRET && url.searchParams.get("key") === process.env.PROOFSNAP_ADMIN_SECRET;
  if (!okCron && !okKey) return Response.json({ error: "unauthorized" }, { status: 401 });

  const t0 = Date.now();
  const worker = await LeanWorker.start();
  const bootMs = Date.now() - t0;
  try {
    const run = await worker.check(
      "import Mathlib\n\ntheorem health_check (n : ℕ) : n + 0 = n := by simp",
      "health_check",
    );
    let snapshotId: string | undefined;
    if (url.searchParams.get("resnapshot") === "1" && run.ok) snapshotId = await worker.resnapshot();
    return Response.json({ ok: run.ok, bootMs, checkMs: run.ms, axioms: run.axioms, snapshotId, raw: run.raw.slice(0, 2000) });
  } finally {
    await worker.stop();
  }
}
