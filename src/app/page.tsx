"use client";

import { useCallback, useRef, useState } from "react";
import type { CheckResult, ProgressEvent, StepResult, Transcription } from "@/lib/pipeline";
import { SAMPLES } from "@/lib/samples";

type Stage = { stage: string; message: string; done: boolean };
type Mode = "photo" | "text";

export default function Home() {
  const [mode, setMode] = useState<Mode>("photo");
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [transcription, setTranscription] = useState<Transcription | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const run = useCallback(
    async (payload: { text?: string; image?: string }) => {
      setBusy(true);
      setStages([]);
      setTranscription(null);
      setResult(null);
      setError(null);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      try {
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const e = JSON.parse(line) as ProgressEvent;
            if (e.type === "stage") {
              setStages((s) => [
                ...s.map((x) => ({ ...x, done: true })),
                { stage: e.stage, message: e.message, done: false },
              ]);
            } else if (e.type === "transcription") {
              setTranscription(e.transcription);
            } else if (e.type === "result") {
              setStages((s) => s.map((x) => ({ ...x, done: true })));
              setResult(e.result);
            } else if (e.type === "error") {
              throw new Error(e.message);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onFile = async (file: File) => {
    const dataUrl = await downscale(file, 1600);
    setImage(dataUrl);
  };

  const canSubmit = !busy && (mode === "photo" ? !!image : text.trim().length > 10);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-10 sm:pt-16">
      <header className="mb-10">
        <div className="flex items-center gap-2 text-sm font-medium text-muted">
          <Logo />
          <span>ProofSnap</span>
          <span className="rounded-full border border-rule bg-card px-2 py-0.5 text-xs">beta</span>
        </div>
        <h1 className="mt-5 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
          Find the exact line where your proof breaks.
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
          Snap a photo of a handwritten proof. ProofSnap translates each step into{" "}
          <span className="text-ink">Lean 4</span>, a proof checker that only accepts valid logic,
          then shows you which steps hold up and which don&apos;t.
        </p>
      </header>

      <section className="rounded-2xl border border-rule bg-card p-4 shadow-[0_1px_0_rgba(0,0,0,0.03),0_8px_30px_-12px_rgba(0,0,0,0.12)] sm:p-6">
        <div className="mb-4 inline-flex rounded-full border border-rule bg-paper p-1 text-sm">
          {(["photo", "text"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-1.5 transition ${
                mode === m ? "bg-ink text-paper" : "text-muted hover:text-ink"
              }`}
            >
              {m === "photo" ? "Photo" : "Type it"}
            </button>
          ))}
        </div>

        {mode === "photo" ? (
          <PhotoInput image={image} onFile={onFile} onClear={() => setImage(null)} />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Theorem: ...\n\nProof:\n1. ...\n2. ..."}
            rows={10}
            className="w-full resize-y rounded-xl border border-rule bg-paper/60 p-4 font-mono text-sm leading-relaxed outline-none focus:border-accent"
          />
        )}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="self-center text-muted">Try:</span>
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => {
                  setMode("text");
                  setText(s.text);
                  run({ text: s.text });
                }}
                className="rounded-full border border-rule bg-paper px-3 py-1 text-ink transition hover:border-ink disabled:opacity-50"
              >
                {s.label}
                <span className={`ml-1.5 ${s.tag === "correct" ? "text-ok" : "text-bad"}`}>
                  {s.tag === "correct" ? "✓" : "✗"}
                </span>
              </button>
            ))}
          </div>
          <button
            disabled={!canSubmit}
            onClick={() => run(mode === "photo" ? { image: image! } : { text })}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Checking…" : "Check my proof"}
          </button>
        </div>
      </section>

      <div ref={resultRef} className="scroll-mt-6">
        {(busy || stages.length > 0) && !result && <Progress stages={stages} busy={busy} />}
        {transcription && !result && <TranscriptionView t={transcription} />}
        {error && (
          <div className="rise mt-8 rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">{error}</div>
        )}
        {result && <ResultView r={result} />}
      </div>

      <footer className="mt-20 border-t border-rule pt-6 text-xs leading-relaxed text-muted">
        ProofSnap uses an AI model to read and translate your proof, and the Lean 4 theorem prover with Mathlib to
        check it. A ✓ means Lean verified that the step follows from the earlier ones. Always read the explanation:
        if the translation of your theorem is off, the check is about a different statement.
      </footer>
    </main>
  );
}

// ---------- input ----------

function PhotoInput({
  image,
  onFile,
  onClear,
}: {
  image: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const [drag, setDrag] = useState(false);
  if (image) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-rule bg-paper">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="Your proof" className="max-h-[420px] w-full object-contain" />
        <button
          onClick={onClear}
          className="absolute right-3 top-3 rounded-full bg-ink/80 px-3 py-1 text-xs text-paper backdrop-blur"
        >
          Replace
        </button>
      </div>
    );
  }
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition ${
        drag ? "border-accent bg-accent/5" : "border-rule bg-paper/60 hover:border-muted"
      }`}
    >
      <CameraIcon />
      <span className="mt-3 font-medium">Take a photo or upload one</span>
      <span className="mt-1 text-sm text-muted">Write the theorem at the top, then the proof. Neat-ish is fine.</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

async function downscale(file: File, maxSide: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- progress ----------

function Progress({ stages, busy }: { stages: Stage[]; busy: boolean }) {
  return (
    <div className="rise mt-10 rounded-2xl border border-rule bg-card p-5">
      <ol className="space-y-3">
        {stages.map((s, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            {s.done ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/15 text-[11px] text-ok">✓</span>
            ) : (
              <span className="flex h-5 w-5 items-center justify-center">
                <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
            )}
            <span className={s.done ? "text-muted" : "text-ink"}>{s.message}</span>
          </li>
        ))}
        {busy && stages.length === 0 && (
          <li className="flex items-center gap-3 text-sm text-muted">
            <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-accent" /> Starting…
          </li>
        )}
      </ol>
      <p className="mt-4 text-xs text-muted">This usually takes 30 to 90 seconds.</p>
    </div>
  );
}

function TranscriptionView({ t }: { t: Transcription }) {
  return (
    <div className="rise mt-6 rounded-2xl border border-rule bg-card p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted">What we read</div>
      <p className="mt-2 font-serif text-lg">{t.theorem}</p>
      <ol className="mt-3 space-y-1.5 text-sm">
        {t.steps.map((s) => (
          <li key={s.id} className="flex gap-3">
            <span className="w-5 shrink-0 text-right font-mono text-muted">{s.id}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- results ----------

const VERDICT = {
  correct: { label: "Verified", cls: "bg-ok text-white", ring: "border-ok/30" },
  has_errors: { label: "Found a problem", cls: "bg-bad text-white", ring: "border-bad/30" },
  could_not_verify: { label: "Couldn't verify", cls: "bg-warn text-white", ring: "border-warn/30" },
} as const;

function ResultView({ r }: { r: CheckResult }) {
  const v = VERDICT[r.verdict];
  const [showLean, setShowLean] = useState(r.verdict !== "correct");
  const errorLines = new Set<number>();
  r.steps.forEach((s) => {
    if (s.status === "error" && s.leanLines) {
      for (let l = s.leanLines[0]; l <= s.leanLines[1]; l++) errorLines.add(l);
    }
  });
  return (
    <div className="rise mt-10 space-y-6">
      <div className={`rounded-2xl border ${v.ring} bg-card p-5 sm:p-6`}>
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${v.cls}`}>{v.label}</span>
        <h2 className="mt-3 font-serif text-2xl leading-snug">{r.headline}</h2>
        {r.hint && <p className="mt-2 text-muted">{r.hint}</p>}
      </div>

      <div className="rounded-2xl border border-rule bg-card p-5 sm:p-6">
        <div className="text-xs font-medium uppercase tracking-wider text-muted">Theorem</div>
        <p className="mt-2 font-serif text-lg">{r.theorem}</p>
        <div className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm">
          <span className="text-muted">Lean checked: </span>
          {r.statementBacktranslation}
          {!r.statementFaithful && (
            <div className="mt-1 text-warn">⚠ This may not match your theorem. {r.statementNote}</div>
          )}
        </div>
      </div>

      <ol className="space-y-3">
        {r.steps.map((s) => (
          <StepCard key={s.id} s={s} />
        ))}
        {r.conclusionErrors.length > 0 && r.steps.every((s) => s.status !== "error") && (
          <li className="rounded-2xl border border-bad/30 bg-card p-4 text-sm">
            <div className="font-medium text-bad">The conclusion doesn&apos;t follow from these steps.</div>
            <p className="mt-1 text-muted">Each step checks out, but together they don&apos;t prove the theorem yet.</p>
          </li>
        )}
      </ol>

      <div className="rounded-2xl border border-rule bg-card">
        <button
          onClick={() => setShowLean((x) => !x)}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium"
        >
          <span>Lean 4 translation{r.attempts > 1 ? ` (${r.attempts} checking passes)` : ""}</span>
          <span className="text-muted">{showLean ? "Hide" : "Show"}</span>
        </button>
        {showLean && (
          <pre className="overflow-x-auto border-t border-rule px-0 py-3 font-mono text-[12.5px] leading-relaxed">
            {r.lean.split("\n").map((line, i) => (
              <div
                key={i}
                className={`flex px-4 ${errorLines.has(i + 1) ? "bg-bad/10" : ""} ${
                  /--\s*STEP/.test(line) ? "text-accent" : ""
                }`}
              >
                <span className="mr-4 w-6 shrink-0 select-none text-right text-muted/60">{i + 1}</span>
                <span className="whitespace-pre">{line}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

function StepCard({ s }: { s: StepResult }) {
  const style =
    s.status === "verified"
      ? { icon: "✓", badge: "bg-ok/15 text-ok", border: "border-rule", label: "Verified" }
      : s.status === "error"
        ? { icon: "✗", badge: "bg-bad text-white", border: "border-bad/40", label: "Doesn't follow" }
        : { icon: "?", badge: "bg-warn/15 text-warn", border: "border-rule", label: "Not checked" };
  return (
    <li className={`rounded-2xl border ${style.border} bg-card p-4`}>
      <div className="flex gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.badge}`}
        >
          {style.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted">Step {s.id}</span>
            <span className="text-xs text-muted">{style.label}</span>
          </div>
          <p className="mt-1 font-serif text-[17px] leading-snug">{s.text}</p>
          {s.explanation && (
            <p className={`mt-2 text-sm leading-relaxed ${s.status === "error" ? "text-ink" : "text-muted"}`}>
              {s.explanation}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------- icons ----------

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 12.5l3 3 6-7" stroke="#2f4fd8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-muted" aria-hidden>
      <path
        d="M4 8.5A2.5 2.5 0 016.5 6h1.3l1.2-1.8A1.5 1.5 0 0110.25 3.5h3.5a1.5 1.5 0 011.25.7L16.2 6h1.3A2.5 2.5 0 0120 8.5v8A2.5 2.5 0 0117.5 19h-11A2.5 2.5 0 014 16.5v-8z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12.5" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
