import { z } from "zod";
import { NextResponse } from "next/server";
import { route, parseBody } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { unsubscribeByToken } from "@/server/admin/marketing";

const schema = z.object({ token: z.string().min(40).max(120) });

/** The press on /unsubscribe: no sign-in, the link itself says who (a keyed digest; owner decision, 11 November 2026). */
export const POST = route(async (req) => {
  const { token } = await parseBody(req, schema);
  if (!(await unsubscribeByToken(token))) throw new AppError(404, "UNSUBSCRIBE_LINK", "This unsubscribe link doesn't work. Use the link in the latest email from us.");
  return NextResponse.json({ ok: true });
});
