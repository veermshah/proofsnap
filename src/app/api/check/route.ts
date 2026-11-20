import { checkProof, type ProgressEvent } from "@/lib/pipeline";

export const maxDuration = 300;

const MAX_IMAGE_CHARS = 8_000_000; // ~6 MB image as base64
const MAX_TEXT_CHARS = 8_000;

export async function POST(req: Request) {
  let body: { text?: string; image?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT_CHARS) : undefined;
  const image = typeof body.image === "string" ? body.image : undefined;
  if (!text?.trim() && !image) {
    return Response.json({ error: "Send a photo or the text of a proof." }, { status: 400 });
  }
  if (image && image.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: "Image is too large. Try a smaller photo." }, { status: 413 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // client went away
        }
      };
      try {
        await checkProof({ text, image }, send);
      } catch (err) {
        console.error(err);
        send({ type: "error", message: err instanceof Error ? err.message : "Something went wrong." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
