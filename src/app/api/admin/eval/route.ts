import { checkProof, type ProgressEvent } from "@/lib/pipeline";
import { SAMPLES } from "@/lib/samples";

export const maxDuration = 300;

// GET /api/admin/eval?key=SECRET&sample=<id>   or   &text=<url-encoded proof>
// Runs the full pipeline and returns the final result as JSON (for testing and evals).
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!process.env.PROOFSNAP_ADMIN_SECRET || url.searchParams.get("key") !== process.env.PROOFSNAP_ADMIN_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const sample = SAMPLES.find((s) => s.id === url.searchParams.get("sample"));
  const text = sample?.text ?? url.searchParams.get("text") ?? "";
  if (!text) return Response.json({ error: "pass sample or text" }, { status: 400 });
  const events: ProgressEvent[] = [];
  try {
    const result = await checkProof({ text }, (e) => events.push(e));
    return Response.json({
      verdict: result.verdict,
      headline: result.headline,
      statementFaithful: result.statementFaithful,
      steps: result.steps.map((s) => ({ id: s.id, status: s.status, text: s.text, explanation: s.explanation })),
      conclusionErrors: result.conclusionErrors,
      attempts: result.attempts,
      axioms: result.axioms,
      timings: result.timings,
      lean: result.lean,
      leanOutput: result.leanOutput.slice(0, 3000),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err), events }, { status: 500 });
  }
}
