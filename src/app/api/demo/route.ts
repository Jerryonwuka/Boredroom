import { route, parseBody, ok } from "@/server/lib/api";
import { demoSchema, requestDemo } from "@/server/admin/demo";

/** The public Book a demo form (owner request, 17 November 2026). Open in every launch mode: a demo needs no account. */
export const POST = route(async (req) => {
  const body = await parseBody(req, demoSchema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return ok(await requestDemo(body, ip), 201);
});
