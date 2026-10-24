import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPage, type RegistryPage } from "@/lib/marketing/registry";
import { OG_IMAGE_SIZE } from "@/lib/marketing/site";

/**
 * The Open Graph and Twitter image of a public page (owner request, 17 October 2026: SEO analysis, A8; the logo PNG the
 * Fix Sheet named is 519×58, so a real 1200×630 image is drawn instead). Design system v4 on the dark canvas: the owner's
 * logo artwork (never typed), the page's section in a hairline pill, its H1 large, tight and white, and a hairline above
 * one quiet line in the secondary grey. Everything is set in Inter 400, the brand's interface face (review fix,
 * 17 October 2026: next/og's built-in face spaced words loosely and is not the brand's), read from
 * src/app/og/fonts/Inter-Regular.ttf (Inter 4.001, SIL Open Font License, OFL.txt beside it) at build time like the
 * logo; next/og cannot read the woff2 files the site itself loads. No gradients or glow; the logo's dot is the only
 * orange. Shared by app/og/route.tsx (the home page and the site default) and
 * app/og/[...slug]/route.tsx (every other registered page); both are generated at build time.
 */

const CANVAS = "#0F0F10";
const FOREGROUND = "#FFFFFF";
const SECONDARY = "rgba(255, 255, 255, 0.64)";
const HAIRLINE = "rgba(255, 255, 255, 0.075)";
const INPUT_HAIRLINE = "rgba(255, 255, 255, 0.10)";

/** The logo artwork as a data URL, read once (public/brand, 519×58). */
let logo: Promise<string> | null = null;
const logoDataUrl = () => (logo ??= readFile(join(process.cwd(), "public/brand/logo-on-dark.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`));

/** Inter Regular for next/og, read once. */
let inter: Promise<Buffer> | null = null;
const interRegular = () => (inter ??= readFile(join(process.cwd(), "src/app/og/fonts/Inter-Regular.ttf")));

/** The display size that keeps a title within three lines. */
const titleSize = (title: string) => (title.length <= 36 ? 76 : title.length <= 60 ? 66 : title.length <= 80 ? 58 : 50);

export async function renderOgImage(page: RegistryPage): Promise<ImageResponse> {
  const section = page.parent && page.parent !== "/" ? getPage(page.parent as RegistryPage["path"]).label : page.kind === "pricing" || page.kind === "download" ? page.label : null;
  const size = titleSize(page.h1);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: CANVAS, padding: "64px 72px 56px", fontFamily: "Inter" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og draws plain <img> */}
          <img src={await logoDataUrl()} width={358} height={40} alt="" />
          {section ? (
            <div style={{ display: "flex", alignItems: "center", height: 48, padding: "0 22px", borderRadius: 999, border: `1.5px solid ${INPUT_HAIRLINE}`, color: SECONDARY, fontSize: 24 }}>{section}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexGrow: 1, alignItems: "center" }}>
          <div style={{ display: "flex", maxWidth: 1000, color: FOREGROUND, fontSize: size, lineHeight: 1.08, letterSpacing: `${(-0.025 * size).toFixed(2)}px` }}>{page.h1}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${HAIRLINE}`, paddingTop: 28, color: SECONDARY, fontSize: 26 }}>
          <div style={{ display: "flex" }}>A personal AI assistant, Brenda, for every person</div>
          <div style={{ display: "flex" }}>boredroom.cc</div>
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE, fonts: [{ name: "Inter", data: await interRegular(), weight: 400, style: "normal" }], headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" } },
  );
}

/** The image of a registered path (404 for anything else). */
export async function ogImageResponse(path: string): Promise<Response> {
  try {
    return await renderOgImage(getPage(path as RegistryPage["path"]));
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
