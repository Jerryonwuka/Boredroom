import { route, ok } from "@/server/lib/api";
import { requireDesktopBearer } from "@/server/auth";
import { desktopSignOut } from "@/server/services/desktop-app";

/**
 * Boredroom for Mac signs out from its notch or menu-bar item (owner request, 24 October 2026: option A): the Bearer's
 * desktop session and every window session tied to it are revoked.
 */
export const POST = route(async () => {
  const bearer = await requireDesktopBearer();
  return ok(await desktopSignOut(bearer));
});
