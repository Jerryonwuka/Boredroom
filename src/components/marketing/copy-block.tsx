"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A block of text to copy or download (owner request, 17 October 2026: SEO analysis: the end-of-day report template is
 * on the page, ungated, in a copyable block). The text is always visible and selectable; Copy puts it on the clipboard
 * (the button says "Copied" for 2 seconds and a status line tells screen readers); Download saves it as `filename`
 * (plain text or Markdown, made in the browser, nothing sent anywhere). Wraps long lines rather than scrolling sideways.
 */
export function CopyBlock({ title, text, filename, className }: {
  title: string;
  text: string;
  /** "end-of-day-report-template.md": offers Download when set (.md is saved as Markdown, anything else as plain text). */
  filename?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setFailed(false); setCopied(true); }
    catch { setFailed(true); }
  };
  const download = () => {
    if (!filename) return;
    const type = filename.endsWith(".md") ? "text/markdown" : "text/plain";
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-background shadow-natural-xs", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-fill-0 py-2 pl-4 pr-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={copy}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy"}</Button>
          {filename ? <Button variant="ghost" size="sm" onClick={download}><Download aria-hidden />Download</Button> : null}
        </div>
      </div>
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[13.6px] leading-[21px] text-foreground sm:p-5"><code>{text}</code></pre>
      <p role="status" className="sr-only">{copied ? `${title} copied to the clipboard.` : failed ? "Copying didn't work here. Select the text and copy it instead." : ""}</p>
    </div>
  );
}
