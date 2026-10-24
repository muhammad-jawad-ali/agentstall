// The generic /api rewrite buffers responses, which would hold back the shopping assistant's live
// steps until it finishes. This route forwards the server-sent event stream unbuffered.

const apiUrl = process.env.API_URL ?? "http://localhost:8787";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of ["cookie", "x-forwarded-for", "x-run-id"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}/api/console/stream`, { method: "POST", headers, body: await req.text() });
  } catch {
    return Response.json({ error: "Can't reach the AgentStall server. Please try again." }, { status: 502 });
  }
  const out = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
  });
  for (const name of ["set-cookie", "x-run-id", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
