import { desktopHtml } from "@/server/lib/desktop-pages";

export const dynamic = "force-dynamic";

/**
 * "Sign in with your browser" (owner request, 24 October 2026: option A). Boredroom for Mac catches this address and
 * opens the sign-in in the person's browser; this page only shows when it didn't (an older app, or a normal browser).
 */
export async function GET() {
  return desktopHtml({
    title: "Boredroom for Mac",
    body: `<h1>This button works in Boredroom for Mac</h1><p>It opens your browser to sign in to the app. In a browser, just sign in as usual.</p><a class="button" href="/download">Get Boredroom for Mac</a> <a class="button" href="/login">Sign in</a>`,
  });
}
