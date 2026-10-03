import { route, ok } from "@/server/lib/api";
import { requireUser } from "@/server/auth";
import { listDevices } from "@/server/services/desktop";

export const GET = route(async () => ok({ devices: await listDevices(await requireUser()) }));
