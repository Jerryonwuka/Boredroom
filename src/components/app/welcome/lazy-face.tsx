"use client";

/**
 * Her small face, loaded after the page (owner request, 11 October 2026: the first-run welcome; contract 4.5 and 10.5).
 * `BrendaFace` reads along with typing through the page-wide `attention` that lives in the canvas engine
 * (lib/brenda-character/engine, about 93 KB of source), so importing it statically puts the whole engine in the page's
 * first script. This stands in for it wherever the welcome (and the assistant editor it shares with Settings) draws a
 * face: a box of the face's exact size is there from the first paint, and the face itself arrives with the engine's chunk
 * after hydration, so nothing shifts and the step's words are on screen first. Same props as `BrendaFace`.
 */
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { BrendaFace as BrendaFaceType } from "@/components/app/brenda-face";
import { cn } from "@/lib/utils";

type FaceProps = ComponentProps<typeof BrendaFaceType>;

const Face = dynamic(() => import("@/components/app/brenda-face").then((m) => m.BrendaFace), { ssr: false });

/** The face's box in px (`.brenda-face-sm/md/lg` in globals.css). */
export const FACE_PX = { sm: 18, md: 26, lg: 34 } as const;

export function LazyFace({ size = "md", className, ...rest }: FaceProps) {
  const px = FACE_PX[size];
  return (
    <span aria-hidden={!rest.interactive} className={cn("inline-grid shrink-0 place-items-center", className)} style={{ width: px, height: px }}>
      <Face size={size} {...rest} />
    </span>
  );
}
