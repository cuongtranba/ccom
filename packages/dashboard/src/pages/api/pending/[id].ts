import type { APIRoute } from "astro";
import { updatePendingActionStatus } from "../../../lib/db";

export const POST: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  const body = await request.json() as { status?: string };
  const status = body.status;

  if (status !== "approved" && status !== "rejected") {
    return new Response("Status must be 'approved' or 'rejected'", { status: 400 });
  }

  try {
    updatePendingActionStatus(id, status);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(message, { status: 500 });
  }
};
