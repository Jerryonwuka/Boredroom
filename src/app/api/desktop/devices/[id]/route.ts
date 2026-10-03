import { route, ok } from "@/server/lib/api";
import { requireUser } from "@/server/auth";
import { revokeDevice } from "@/server/services/desktop";

/** Unlinks a computer. */
export const DELETE = route<{ id: string }>(async (_req, { params }) => ok(await revokeDevice(await requireUser(), params.id)));
