import type { APIRoute } from "astro";
import { castVote } from "../../lib/db";

interface VoteBody {
  crId?: string;
  nodeId?: string;
  vertical?: string;
  approve?: boolean;
  reason?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json() as VoteBody;
  const { crId, nodeId, vertical, approve, reason } = body;

  if (!crId || !nodeId || !vertical || typeof approve !== "boolean") {
    return new Response("Missing required fields: crId, nodeId, vertical, approve", {
      status: 400,
    });
  }

  try {
    castVote(crId, nodeId, vertical, approve, reason ?? "");
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(message, { status: 500 });
  }
};
