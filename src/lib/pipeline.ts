import { generateText, Output, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { LeanWorker, type LeanRun, STANDARD_AXIOMS } from "./lean";

export const THEOREM_NAME = "student_claim";
const MODEL_ID = process.env.PROOFSNAP_MODEL ?? "anthropic/claude-sonnet-5.5";
const FAST_MODEL_ID = process.env.PROOFSNAP_FAST_MODEL ?? MODEL_ID;

/** Use the Anthropic API directly when a key is set, otherwise Vercel AI Gateway (OIDC). */
function resolveModel(id: string): LanguageModel {
  if (process.env.ANTHROPIC_API_KEY && id.startsWith("anthropic/")) {
    return anthropic(id.slice("anthropic/".length).replace(/\./g, "-"));
  }
  return id;
}
const MODEL = resolveModel(MODEL_ID);
const FAST_MODEL = resolveModel(FAST_MODEL_ID);
const MAX_REPAIRS = Number(process.env.PROOFSNAP_MAX_REPAIRS ?? 2);

// ---------- types ----------

export type ProofStep = { id: number; text: string };

export type Transcription = {
  theorem: string;
  steps: ProofStep[];
  illegible: string;
};

export type StepStatus = "verified" | "error" | "unchecked";

export type StepResult = {
  id: number;
  text: string;
  status: StepStatus;
  leanLines: [number, number] | null;
  leanErrors: string[];
  explanation: string;
};

export type CheckResult = {
  verdict: "correct" | "has_errors" | "could_not_verify";
  headline: string;
  hint: string;
  statementFaithful: boolean;
  statementNote: string;
  theorem: string;
  statementBacktranslation: string;
  steps: StepResult[];
  conclusionErrors: string[];
  lean: string;
  leanOutput: string;
  axioms: string[];
  attempts: number;
  timings: Record<string, number>;
};

export type ProgressEvent =
  | { type: "stage"; stage: string; message: string }
  | { type: "transcription"; transcription: Transcription }
  | { type: "lean"; attempt: number; ok: boolean; errors: number }
  | { type: "result"; result: CheckResult }
  | { type: "error"; message: string };

// ---------- step 1: read the proof ----------

const transcriptionSchema = z.object({
  theorem: z
    .string()
    .describe("The statement being proved, in plain text with simple math notation (use ^, *, <=, sum_{i=1}^{n}, etc.)"),
  steps: z
    .array(z.object({ id: z.number().int(), text: z.string() }))
    .describe("The proof split into its logical steps, in order, numbered from 1. Keep the student's own claims and wording."),
  illegible: z.string().describe("Anything you could not read or had to guess. Empty string if none."),
});

const TRANSCRIBE_SYSTEM = `You transcribe student math proofs for an automated proof checker.
Split the proof into its logical steps: each step is ONE claim the student makes (plus the reason they give, if any).
Rules:
- Transcribe faithfully. NEVER fix, complete, or improve the student's reasoning, even if it is wrong. Wrong steps must stay wrong.
- Keep the student's order. Do not merge distinct claims. Setup lines ("Let n be even", "Base case:", "Assume P(k)") count as steps.
- If the input is a photo, read the handwriting carefully; record unreadable parts in "illegible".
- If the theorem statement is not written explicitly, infer it from context and say so in "illegible".`;

export async function transcribe(input: { text?: string; image?: string }): Promise<Transcription> {
  const content: Array<
    { type: "text"; text: string } | { type: "file"; mediaType: string; data: string }
  > = [];
  if (input.image) {
    const m = input.image.match(/^data:(image\/[a-zA-Z+.-]+);base64,([\s\S]*)$/);
    if (!m) throw new Error("Image must be a base64 data URL");
    content.push({ type: "file", mediaType: m[1], data: m[2] });
    content.push({ type: "text", text: "Transcribe the theorem and proof in this photo." });
  }
  if (input.text?.trim()) {
    content.push({ type: "text", text: `Theorem and proof:\n\n${input.text.trim()}` });
  }
  if (content.length === 0) throw new Error("Send a photo or the text of a proof.");

  const { output } = await generateText({
    model: FAST_MODEL,
    system: TRANSCRIBE_SYSTEM,
    messages: [{ role: "user", content }],
    output: Output.object({ schema: transcriptionSchema }),
  });
  return {
    theorem: output.theorem,
    steps: output.steps.map((s, i) => ({ id: i + 1, text: s.text })),
    illegible: output.illegible,
  };
}

// ---------- step 2: formalize in Lean ----------

const formalizationSchema = z.object({
  statementBacktranslation: z
    .string()
    .describe("Plain-English reading of exactly what your Lean theorem statement says, including types (natural numbers, integers, reals) and hypotheses."),
  lean: z.string().describe("The complete Lean 4 file, starting with `import Mathlib`."),
});

const FORMALIZE_RULES = `You translate a student's proof into Lean 4 + Mathlib so Lean can check each step.
The goal is to find out whether THE STUDENT'S reasoning is valid, step by step. You are a faithful translator, not a tutor.

File format (follow exactly):
\`\`\`lean
import Mathlib

theorem ${THEOREM_NAME} <binders and hypotheses> : <goal> := by
  -- STEP 1
  have s1 : <the claim the student makes in step 1> := by
    <tactics proving it from the hypotheses and earlier steps>
  -- STEP 2
  have s2 : <claim of step 2> := by
    <tactics>
  ...
  -- CONCLUSION
  <tactics that finish the goal using the steps, e.g. exact s4>
\`\`\`

Rules:
1. Every student step gets a "-- STEP k" marker line, using the step numbers given. Markers may be nested (e.g. inside an induction case), but every step k must appear exactly once, in order.
2. Each step's claim must be what THE STUDENT claims, translated literally. If a student claim is false or does not follow, still state it as the student wrote it. Never weaken, strengthen or repair a claim, and never add facts the student did not state.
3. The proof of each \`have\` may only use the hypotheses, earlier steps, and general Mathlib facts/automation (omega, simp, linarith, nlinarith, norm_num, ring, ring_nf, positivity, decide, Finset.sum_range_succ, aesop, etc.). That way, if the student skipped a needed fact, the step fails.
4. Setup steps ("Let n = 2k", "Assume ...") become obtain/intro/have as appropriate. For induction use \`induction n with\` / \`| zero => ...\` / \`| succ k ih => ...\` and put base-case and inductive-step markers inside the right case.
5. The theorem statement must say exactly what the student set out to prove: same quantifiers, same domain (ℕ vs ℤ vs ℝ), same hypotheses. Natural-number subtraction and division are truncated in Lean; use ℤ or ℝ when the math needs real subtraction/division.
6. Never use sorry, admit, axiom, native_decide, or set_option. Do not change the theorem name.
7. Use current Lean 4 Mathlib syntax (e.g. \`Finset.sum (Finset.range (n+1)) (fun i => i)\` or \`∑ i ∈ Finset.range (n + 1), i\`, \`Even n\`, \`Odd n\`, \`n % 2 = 0\`, \`Nat.Prime p\`, \`¬\`, \`∣\`).`;

function stepsBlock(t: Transcription) {
  return t.steps.map((s) => `STEP ${s.id}: ${s.text}`).join("\n");
}

async function formalize(t: Transcription) {
  const { output } = await generateText({
    model: MODEL,
    system: FORMALIZE_RULES,
    prompt: `Theorem the student is proving:\n${t.theorem}\n\nStudent's proof, by step:\n${stepsBlock(t)}\n\nWrite the Lean file.`,
    output: Output.object({ schema: formalizationSchema }),
  });
  return { lean: cleanLean(output.lean), statementBacktranslation: output.statementBacktranslation };
}

const repairSchema = z.object({
  statementBacktranslation: z.string(),
  lean: z.string(),
  genuineGaps: z
    .array(z.object({ step: z.number().int(), reason: z.string() }))
    .describe("Steps you believe fail because the STUDENT's claim is false or does not follow, not because of Lean technicalities."),
});

async function repair(
  t: Transcription,
  lean: string,
  run: LeanRun,
  backtranslation: string,
) {
  const errors = describeErrors(lean, run);
  const { output } = await generateText({
    model: MODEL,
    system: `${FORMALIZE_RULES}

You are now REVISING a Lean file that failed to check. For each error decide:
- TECHNICAL problem (syntax, wrong lemma name, wrong coercion, automation too weak for a claim that really does follow from earlier steps): fix it. You may restructure the tactic proof of a step, but not its claim.
- GENUINE gap (the student's claim is false, or does not follow from the hypotheses and earlier steps): do NOT change the claim to make it pass. Leave it, keep a reasonable proof attempt, and list it in genuineGaps.
- If the theorem statement itself fails to elaborate, fix the statement while keeping its meaning.`,
    prompt: `Theorem:\n${t.theorem}\n\nStudent's proof, by step:\n${stepsBlock(t)}\n\nYour previous back-translation: ${backtranslation}\n\nPrevious Lean file:\n\`\`\`lean\n${numbered(lean)}\n\`\`\`\n\nLean errors:\n${errors}\n\nReturn the revised complete Lean file (without line numbers).`,
    output: Output.object({ schema: repairSchema }),
  });
  return {
    lean: cleanLean(output.lean),
    statementBacktranslation: output.statementBacktranslation,
    genuineGaps: output.genuineGaps,
  };
}

// ---------- step 3: explain ----------

const explainSchema = z.object({
  headline: z.string().describe("One sentence verdict a student would understand."),
  hint: z
    .string()
    .describe("If there is an error: a hint toward fixing it without writing the fix. If correct: one sentence on what made it work."),
  statementFaithful: z.boolean().describe("Does the Lean theorem statement match what the student set out to prove?"),
  statementNote: z.string().describe("If not faithful, what differs. Otherwise an empty string."),
  steps: z.array(
    z.object({
      id: z.number().int(),
      explanation: z
        .string()
        .describe("1-2 sentences. For error steps: what is wrong in the student's reasoning, with a concrete counterexample if one exists. For verified steps: brief confirmation. For unchecked: why it could not be checked."),
    }),
  ),
});

async function explain(
  t: Transcription,
  lean: string,
  backtranslation: string,
  steps: StepResult[],
  gaps: { step: number; reason: string }[],
  verdict: CheckResult["verdict"],
) {
  const stepSummary = steps
    .map(
      (s) =>
        `STEP ${s.id} [${s.status.toUpperCase()}]: ${s.text}${
          s.leanErrors.length ? `\n  Lean error: ${s.leanErrors.join(" | ").slice(0, 600)}` : ""
        }`,
    )
    .join("\n");
  const { output } = await generateText({
    model: FAST_MODEL,
    system: `You explain the results of a Lean proof check to a student taking an intro proofs course.
Lean results are ground truth: VERIFIED steps are logically valid; ERROR steps could not be derived from the earlier steps; UNCHECKED steps were not reached or not checked.
Be precise, kind and short. Talk about the math, not about Lean, unless the problem is that the formal statement does not match the student's theorem.
Note: a step can be VERIFIED even if the student's stated justification is weak; mention that if so.`,
    prompt: `Overall verdict: ${verdict}\n\nTheorem: ${t.theorem}\n\nLean theorem statement reads as: ${backtranslation}\n\nSteps and Lean results:\n${stepSummary}\n\nTranslator's notes on genuine gaps: ${
      gaps.length ? gaps.map((g) => `step ${g.step}: ${g.reason}`).join("; ") : "none"
    }\n\nLean file:\n\`\`\`lean\n${lean}\n\`\`\``,
    output: Output.object({ schema: explainSchema }),
  });
  return output;
}

// ---------- orchestration ----------

export async function checkProof(
  input: { text?: string; image?: string },
  emit: (e: ProgressEvent) => void,
): Promise<CheckResult> {
  const timings: Record<string, number> = {};
  const t0 = Date.now();

  emit({ type: "stage", stage: "read", message: input.image ? "Reading your handwriting" : "Reading your proof" });
  // Boot the Lean VM while the model reads the proof.
  const workerPromise = LeanWorker.start().then((w) => {
    w.warm();
    return w;
  });
  workerPromise.catch(() => {});

  let worker: LeanWorker | null = null;
  try {
    const transcription = await transcribe(input);
    timings.read = Date.now() - t0;
    emit({ type: "transcription", transcription });

    emit({ type: "stage", stage: "formalize", message: "Translating each step into Lean" });
    let t1 = Date.now();
    let { lean, statementBacktranslation } = await formalize(transcription);
    timings.formalize = Date.now() - t1;

    emit({ type: "stage", stage: "boot", message: "Starting the Lean checker" });
    t1 = Date.now();
    worker = await workerPromise;
    timings.boot = Date.now() - t1;

    emit({ type: "stage", stage: "check", message: "Lean is checking every step" });
    t1 = Date.now();
    let run = await worker.check(lean, THEOREM_NAME);
    let attempts = 1;
    emit({ type: "lean", attempt: attempts, ok: run.ok, errors: errorCount(run) });
    let gaps: { step: number; reason: string }[] = [];

    while (!isClean(run) && attempts <= MAX_REPAIRS && Date.now() - t0 < 170_000) {
      emit({
        type: "stage",
        stage: "repair",
        message: `Separating Lean typos from real gaps (pass ${attempts})`,
      });
      const fixed = await repair(transcription, lean, run, statementBacktranslation);
      lean = fixed.lean;
      statementBacktranslation = fixed.statementBacktranslation;
      gaps = fixed.genuineGaps;
      run = await worker.check(lean, THEOREM_NAME);
      attempts++;
      emit({ type: "lean", attempt: attempts, ok: run.ok, errors: errorCount(run) });
      // If the only failures are steps the translator says are genuine gaps, stop repairing.
      const failing = failingSteps(lean, run);
      if (failing.length > 0 && failing.every((s) => gaps.some((g) => g.step === s))) break;
    }
    timings.check = Date.now() - t1;

    const steps = assignSteps(transcription, lean, run);
    const statementError = run.messages.some(
      (m) => m.severity === "error" && stepForLine(lean, m.line) === null && !isConclusionLine(lean, m.line),
    );
    const badAxioms = run.axioms.filter((a) => !STANDARD_AXIOMS.has(a) && a !== "sorryAx");
    let verdict: CheckResult["verdict"];
    if (statementError || badAxioms.length) {
      verdict = "could_not_verify";
    } else if (isClean(run)) {
      verdict = "correct";
    } else {
      // Either a step failed, or the steps do not add up to the theorem (conclusion failed).
      verdict = "has_errors";
    }

    emit({ type: "stage", stage: "explain", message: "Writing up what Lean found" });
    t1 = Date.now();
    const ex = await explain(transcription, lean, statementBacktranslation, steps, gaps, verdict);
    timings.explain = Date.now() - t1;
    for (const s of steps) {
      s.explanation = ex.steps.find((e) => e.id === s.id)?.explanation ?? "";
    }
    if (!ex.statementFaithful && verdict === "correct") verdict = "could_not_verify";
    timings.total = Date.now() - t0;

    const result: CheckResult = {
      verdict,
      headline: ex.headline,
      hint: ex.hint,
      statementFaithful: ex.statementFaithful,
      statementNote: ex.statementNote,
      theorem: transcription.theorem,
      statementBacktranslation,
      steps,
      conclusionErrors: run.messages
        .filter((m) => m.severity === "error" && isConclusionLine(lean, m.line))
        .map((m) => m.text),
      lean,
      leanOutput: run.raw.slice(0, 20_000),
      axioms: run.axioms,
      attempts,
      timings,
    };
    emit({ type: "result", result });
    return result;
  } finally {
    if (worker) await worker.stop();
    else workerPromise.then((w) => w.stop()).catch(() => {});
  }
}

// ---------- helpers ----------

export function cleanLean(code: string) {
  let c = code.trim();
  const fence = c.match(/```(?:lean4?|)\s*\n([\s\S]*?)```/);
  if (fence) c = fence[1].trim();
  // strip accidental line-number prefixes like "12 | "
  if (/^\s*1\s*\|/.test(c)) c = c.replace(/^\s*\d+\s*\|\s?/gm, "");
  if (!c.startsWith("import")) c = `import Mathlib\n\n${c}`;
  return c;
}

function numbered(code: string) {
  return code
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3)} | ${l}`)
    .join("\n");
}

type Marker = { step: number; line: number };

export function stepMarkers(lean: string): Marker[] {
  const markers: Marker[] = [];
  lean.split("\n").forEach((l, i) => {
    const m = l.match(/--\s*STEP\s+(\d+)/i);
    if (m) markers.push({ step: Number(m[1]), line: i + 1 });
  });
  return markers;
}

function conclusionLine(lean: string): number | null {
  const idx = lean.split("\n").findIndex((l) => /--\s*CONCLUSION/i.test(l));
  return idx === -1 ? null : idx + 1;
}

function isConclusionLine(lean: string, line: number) {
  const c = conclusionLine(lean);
  return c !== null && line >= c;
}

/** The step whose marker is the closest one at or before `line` (ignoring lines after CONCLUSION). */
export function stepForLine(lean: string, line: number): number | null {
  const c = conclusionLine(lean);
  if (c !== null && line >= c) return null;
  let best: Marker | null = null;
  for (const m of stepMarkers(lean)) if (m.line <= line && (!best || m.line > best.line)) best = m;
  return best ? best.step : null;
}

function errorCount(run: LeanRun) {
  return run.messages.filter((m) => m.severity === "error").length;
}

function isClean(run: LeanRun) {
  return run.ok && !run.usesSorry && run.axioms.every((a) => STANDARD_AXIOMS.has(a));
}

function failingSteps(lean: string, run: LeanRun) {
  const s = new Set<number>();
  for (const m of run.messages) {
    if (m.severity !== "error") continue;
    const k = stepForLine(lean, m.line);
    if (k !== null) s.add(k);
  }
  return [...s];
}

function describeErrors(lean: string, run: LeanRun) {
  const errs = run.messages.filter((m) => m.severity === "error");
  const parts = errs.slice(0, 12).map((m) => {
    const k = stepForLine(lean, m.line);
    const where = k !== null ? `STEP ${k}` : isConclusionLine(lean, m.line) ? "CONCLUSION" : "theorem statement / outside steps";
    return `line ${m.line}:${m.column} (${where}): ${m.text.slice(0, 800)}`;
  });
  if (run.usesSorry) parts.push("The proof uses sorry somewhere (not allowed).");
  return parts.join("\n\n") || "(no error messages, but the proof did not fully check)";
}

export function assignSteps(t: Transcription, lean: string, run: LeanRun): StepResult[] {
  const markers = stepMarkers(lean);
  const lines = lean.split("\n").length;
  const conc = conclusionLine(lean) ?? lines + 1;
  const sorted = [...markers].sort((a, b) => a.line - b.line);
  const errorsByStep = new Map<number, string[]>();
  for (const m of run.messages) {
    if (m.severity !== "error") continue;
    const k = stepForLine(lean, m.line);
    if (k === null) continue;
    errorsByStep.set(k, [...(errorsByStep.get(k) ?? []), m.text]);
  }
  const hardFail = run.messages.some(
    (m) => m.severity === "error" && stepForLine(lean, m.line) === null && !isConclusionLine(lean, m.line),
  );
  return t.steps.map((s) => {
    const mk = sorted.find((m) => m.step === s.id);
    let span: [number, number] | null = null;
    if (mk) {
      const next = sorted.find((m) => m.line > mk.line);
      span = [mk.line, Math.min(next ? next.line - 1 : conc - 1, conc - 1)];
    }
    const errs = errorsByStep.get(s.id) ?? [];
    let status: StepStatus;
    if (!mk || hardFail) status = "unchecked";
    else if (errs.length) status = "error";
    else status = "verified";
    return { id: s.id, text: s.text, status, leanLines: span, leanErrors: errs, explanation: "" };
  });
}
