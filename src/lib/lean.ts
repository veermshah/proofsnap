import { Sandbox } from "@vercel/sandbox";

export const LEAN_PROJECT_DIR = "/vercel/sandbox/checker";
const LEAN_BIN_DIR = process.env.LEAN_BIN_DIR ?? "/vercel/.elan/bin";

export type LeanMessage = {
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  text: string;
};

export type LeanRun = {
  ok: boolean; // compiled with no errors
  messages: LeanMessage[];
  axioms: string[]; // axioms used by the main theorem
  usesSorry: boolean;
  raw: string;
  ms: number;
};

/**
 * A Lean worker is one Vercel Sandbox booted from a snapshot that already
 * contains elan, Lean and a Mathlib project with its build cache.
 * The VM has no network access, so generated Lean code cannot reach anything.
 */
export class LeanWorker {
  private warming: Promise<unknown> | null = null;
  private constructor(private sandbox: Sandbox) {}

  /** Load Mathlib into the page cache in the background, so the first real check is fast. */
  warm() {
    if (!this.warming) {
      this.warming = this.check("import Mathlib\n\ntheorem warm_up : True := trivial", "warm_up").catch(() => {});
    }
    return this.warming;
  }

  static async start(): Promise<LeanWorker> {
    const snapshotId = process.env.LEAN_SNAPSHOT_ID;
    if (!snapshotId) throw new Error("LEAN_SNAPSHOT_ID is not configured");
    const sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId },
      resources: { vcpus: 4 },
      timeout: 5 * 60 * 1000,
      persistent: false,
      networkPolicy: "deny-all",
    });
    return new LeanWorker(sandbox);
  }

  async check(code: string, theoremName: string): Promise<LeanRun> {
    if (this.warming && theoremName !== "warm_up") await this.warming;
    const started = Date.now();
    const file = `Proof_${Math.random().toString(36).slice(2, 10)}.lean`;
    const body = `${code.trimEnd()}\n\n#print axioms ${theoremName}\n`;
    await this.sandbox.writeFiles([
      { path: `${LEAN_PROJECT_DIR}/${file}`, content: Buffer.from(body) },
    ]);
    const result = await this.sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `cd ${LEAN_PROJECT_DIR} && timeout 150 ${LEAN_BIN_DIR}/lake env lean ${file} 2>&1; echo "__EXIT__$?"`,
      ],
    });
    const raw = await result.stdout();
    const exitMatch = raw.match(/__EXIT__(\d+)/);
    const exitCode = exitMatch ? Number(exitMatch[1]) : 1;
    const output = raw.replace(/__EXIT__\d+\s*$/, "");
    const messages = parseLeanOutput(output, file);
    const axioms = parseAxioms(output);
    const usesSorry =
      axioms.includes("sorryAx") ||
      messages.some((m) => /declaration uses 'sorry'/.test(m.text));
    const timedOut = exitCode === 124;
    if (timedOut) {
      messages.push({
        line: 1,
        column: 0,
        severity: "error",
        text: "Lean timed out while checking this proof.",
      });
    }
    return {
      ok: !timedOut && !messages.some((m) => m.severity === "error"),
      messages,
      axioms,
      usesSorry,
      raw: output,
      ms: Date.now() - started,
    };
  }

  /** Save this VM as a snapshot that never expires. Stops the VM. */
  async resnapshot(): Promise<string> {
    const snap = await this.sandbox.snapshot({ expiration: 0 });
    return snap.snapshotId;
  }

  async stop() {
    try {
      await this.sandbox.stop();
    } catch {
      // already stopped
    }
  }
}

export function parseLeanOutput(output: string, file: string): LeanMessage[] {
  const messages: LeanMessage[] = [];
  const header = /^(.*?):(\d+):(\d+): (error|warning|info|information): ?(.*)$/;
  let current: LeanMessage | null = null;
  for (const line of output.split("\n")) {
    if (/^'.*' (depends on axioms|does not depend on any axioms)/.test(line)) {
      if (current) messages.push(current);
      current = null;
      continue;
    }
    const m = line.match(header);
    if (m && (m[1].endsWith(file) || m[1].endsWith(".lean"))) {
      if (current) messages.push(current);
      const sev = m[4] === "information" ? "info" : (m[4] as LeanMessage["severity"]);
      current = { line: Number(m[2]), column: Number(m[3]), severity: sev, text: m[5] };
    } else if (current) {
      current.text += "\n" + line;
    }
  }
  if (current) messages.push(current);
  return messages
    .map((m) => ({ ...m, text: m.text.trimEnd() }))
    .filter((m) => !/^'.*' depends on axioms/.test(m.text) && !/does not depend on any axioms/.test(m.text));
}

export function parseAxioms(output: string): string[] {
  const m = output.match(/depends on axioms: \[([^\]]*)\]/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const STANDARD_AXIOMS = new Set(["propext", "Classical.choice", "Quot.sound"]);
