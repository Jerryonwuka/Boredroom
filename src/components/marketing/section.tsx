import { WRAP, arrive } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

/**
 * Sections of a product-style public page (owner request, 17 October 2026: SEO analysis; v2, owner feedback the same day:
 * "they just look like HTML files… just look like blog stuff", so the pages read as product pages, like the home page).
 *
 * `SectionLabel`: the small neutral chip above a section title (1 to 3 words, sentence case; a `<p>`, never a heading,
 * never orange: the accent rules), with an optional 14px icon.
 *
 * `SectionHead`: label, h2 (`.mk-h2`, the display face, 30 → 36 → 40px), a line under it in the secondary grey and an
 * optional action (links) under that. They arrive in that order, once, as the home page's section titles do.
 *
 * `Section`: a page section, `py-20 sm:py-28` (the home page's rhythm), the head then the content 48px under it. The h2
 * gets `${id}-title`; the section `id` is the anchor. `tone="tint"` puts it on a full-bleed fill-0 band between
 * hairlines (two a page at most, never adjacent); `width="text"` keeps head and content in a 44rem column for a stretch
 * of long-form reasoning. `align` is "left" by default (back-compatible) or "center".
 */

export function SectionLabel({ children, icon, className, style }: { children: React.ReactNode; icon?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <p className={cn("inline-flex h-7 items-center gap-1.5 rounded-full bg-fill-1 px-3 text-meta font-medium text-secondary [&_svg]:size-3.5 [&_svg]:shrink-0", className)} style={style}>
      {icon}{children}
    </p>
  );
}

export type SectionHeadProps = {
  /** The h2's id (`${section id}-title` inside a Section). */
  id?: string;
  label?: React.ReactNode;
  labelIcon?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  align?: "left" | "center";
  /** Under the sub: links to the pages that cover the section in full (SectionLinks), a button row … */
  action?: React.ReactNode;
  className?: string;
};

export function SectionHead({ id, label, labelIcon, title, sub, align = "left", action, className }: SectionHeadProps) {
  const centred = align === "center";
  return (
    <div data-lp-arrive className={cn("max-w-3xl", centred && "mx-auto text-center", className)}>
      {label ? <div className="lp-item mb-5" style={arrive(0)}><SectionLabel icon={labelIcon}>{label}</SectionLabel></div> : null}
      <h2 id={id} className="mk-h2 lp-item" style={arrive(1)}>{title}</h2>
      {sub ? <div className={cn("lp-sub lp-item mk-links mt-4 max-w-2xl [&>*+*]:mt-3", centred && "mx-auto")} style={arrive(2)}>{sub}</div> : null}
      {action ? <div className={cn("lp-item mt-5 flex flex-wrap gap-3", centred && "justify-center")} style={arrive(3)}>{action}</div> : null}
    </div>
  );
}

export function Section({ id, label, labelIcon, title, sub, align = "left", tone = "plain", width = "wide", action, children, className, contentClassName }: Omit<SectionHeadProps, "id" | "className"> & {
  id: string;
  tone?: "plain" | "tint";
  width?: "wide" | "text";
  children?: React.ReactNode;
  className?: string;
  /** Classes for the content's wrapper (under the head). */
  contentClassName?: string;
}) {
  const text = width === "text";
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 py-20 sm:py-28", tone === "tint" && "border-y border-border bg-fill-0", className)}>
      <div className={cn(WRAP, text && "max-w-[calc(44rem+48px)]")}>
        <SectionHead id={`${id}-title`} label={label} labelIcon={labelIcon} title={title} sub={sub} align={align} action={action}
          className={cn(text && "max-w-none")} />
        {children ? <div className={cn("mt-12", contentClassName)}>{children}</div> : null}
      </div>
    </section>
  );
}
