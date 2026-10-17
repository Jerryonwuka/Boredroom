import { cache } from "react";
import { getCurrentUser } from "@/server/auth";
import { launchSettings, landingSettings, type LaunchSettings, type LandingSettings } from "@/server/admin/settings";

/**
 * What the public pages need to know about the launch (owner request, 17 October 2026: SEO analysis): who is looking and
 * which mode the site is in, so every call to action works in each mode, as on the home page: signed in it opens the
 * workspace; in waitlist mode it goes to the waitlist form (the closing section of every marketing page carries it); in
 * maintenance sign-ups are off, so it is Log in; otherwise Get started. Read once per request (React cache); the settings
 * themselves are cached in memory for 15 seconds. A public page never fails over the database: a slow or absent
 * connection means the defaults (live mode, signed out), as on the home page.
 */
export type LaunchState = {
  signedIn: boolean;
  waitlist: boolean;
  maintenance: boolean;
  /** The admin's maintenance notice (launch.message), trimmed; may be empty. */
  notice: string;
  /** The admin's landing copy (Control Center): replaces the closing headline, line and button in waitlist mode. */
  copy: LandingSettings;
};

export const getLaunchState = cache(async (): Promise<LaunchState> => {
  const [user, launch, copy] = await Promise.all([
    getCurrentUser().catch(() => null),
    launchSettings().catch((): LaunchSettings => ({ mode: "live", waitlist_open: true, app_access: true })),
    landingSettings().catch((): LandingSettings => ({ headline: "", subheadline: "", cta: "" })),
  ]);
  return { signedIn: !!user, waitlist: launch.mode === "waitlist", maintenance: launch.mode === "maintenance", notice: launch.message?.trim() ?? "", copy };
});
