"use client";

/**
 * The Control Center's period switch (AI usage): a segmented control that puts `?period=` in the address, keeping the
 * page's other parameters (the sort). The page reads the period on the server, so a link or a reload lands on it.
 */
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";

export function PeriodSwitch({ value, options, label = "Period" }: { value: string; options: readonly { value: string; label: string }[]; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <Segmented aria-label={label} value={value} options={options.map((o) => ({ value: o.value, label: o.label }))} className={pending ? "opacity-70" : undefined}
      onChange={(v) => {
        const p = new URLSearchParams(params.toString());
        if (v === options[0]?.value) p.delete("period"); else p.set("period", v);
        const q = p.toString();
        start(() => router.push(q ? `${pathname}?${q}` : pathname, { scroll: false }));
      }} />
  );
}
