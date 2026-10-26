import { SiteNavClient } from "@/components/landing/site-nav-client";
import { navMenus } from "@/lib/marketing/menus";
import { desktopDownloadUrl } from "@/lib/desktop-download";

/**
 * The site's notch nav (owner request, 10 October 2026; the client component and its reasons: site-nav-client.tsx). A
 * server wrapper since the mega-menus (owner feedback, 17 October 2026: pages v2): it builds the menus from the registry
 * here, so only their slim data (paths, labels, one-line descriptions, icon names) reaches the browser, never the
 * registry's copy. Same export and props as before, so the home page and the marketing layout are unchanged.
 * `download`: whether Boredroom for Mac is on offer (DESKTOP_DOWNLOAD_URL is not "off"), for the header's Download link.
 */
export function SiteNav({ signedIn, waitlist = false, maintenance = false }: { signedIn: boolean; waitlist?: boolean; maintenance?: boolean }) {
  return <SiteNavClient signedIn={signedIn} waitlist={waitlist} maintenance={maintenance} menus={navMenus()} download={desktopDownloadUrl() !== null} />;
}
