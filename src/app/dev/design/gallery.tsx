"use client";

/**
 * /dev/design: design system v4 in one page. Each section shows the parts in the dark and the light theme side by side
 * (a nested [data-theme] re-declares every token). "Hover" and "Focus" columns are drawn with the same classes the
 * real states use, so they can be compared at rest; everything is also live. Overlays (sheets, dialogs, menus,
 * popovers, tooltips, toasts) open in the page's own theme: switch it with the toggle at the top.
 */
import * as React from "react";
import { Toaster } from "sonner";
import {
  AlarmClock, ArrowUpRight, Bell, CalendarCheck, CalendarClock, CircleAlert, ClipboardCheck, Clock, Copy, CreditCard, Ellipsis, FileText, Folder,
  Hourglass, Inbox, LayoutDashboard, ListOrdered, ListTodo, MessageSquare, MessageSquareReply, Pause, Pencil, Plus, Search, Settings,
  SquareCheckBig, Trash2, TriangleAlert, Users,
} from "lucide-react";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { VoiceCapture } from "@/components/app/voice-capture";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { Logo } from "@/components/logo";
import { PromptAction, PromptInputBox, PromptTextAction } from "@/components/ui/ai-prompt-box";
import { AnalyticsCard, MetricStrip } from "@/components/ui/analytics-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge, CountPill, Kbd, MonoChip, NewBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Ledger, PageHeader, SectionCard, SectionTitle } from "@/components/ui/card";
import { AreaChart, BarChart, Donut, SegmentBar, Sparkline } from "@/components/ui/charts";
import { ConfirmButton } from "@/components/ui/confirm";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationPicker } from "@/components/ui/duration-picker";
import { EditButton } from "@/components/ui/edit-button";
import { FilterBar, FilterControl, FilterSelect } from "@/components/ui/filter-control";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input, InputAdorned, Select, Textarea } from "@/components/ui/input";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from "@/components/ui/menu";
import { ProgressArc, ProgressBar } from "@/components/ui/progress-arc";
import { ListRow, Row, RowList, SubNavItem } from "@/components/ui/rows";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { LiveIndicator, StatusDot } from "@/components/ui/status-dot";
import { Dialog, Sheet } from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/states";
import { Checkbox, Radio, Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { TimePicker } from "@/components/ui/time-picker";
import { notify, ToastCard } from "@/components/ui/toast";
import { QuickLink, ToolSquare, ToolTile, ToolTileRow } from "@/components/ui/tool-tile";
import { cn } from "@/lib/utils";
import { SampleAppFrame } from "./app-frame";

type Theme = "dark" | "light";

const SECTIONS = [
  ["foundations", "Foundations"], ["accents", "Accents"], ["type", "Type"], ["buttons", "Buttons"], ["inputs", "Inputs"], ["selection", "Selection"],
  ["tabs", "Tabs"], ["badges", "Badges"], ["cards", "Cards"], ["stats", "Stat cards"], ["analytics", "Analytics"],
  ["filters", "Filters"], ["tiles", "Tool tiles"], ["lists", "Lists"], ["tables", "Tables"], ["feedback", "Feedback"],
  ["overlays", "Overlays"], ["pickers", "Pickers"], ["prompt", "Prompt"], ["charts", "Charts"], ["frame", "App frame"],
] as const;

function ThemePanel({ theme, children, className }: { theme: Theme; children: React.ReactNode; className?: string }) {
  return (
    <div data-theme={theme} className={cn("min-w-0 rounded-2xl border border-border bg-background p-5 text-foreground", className)}>
      <p className="mb-4 text-xs font-medium text-subtle">{theme === "dark" ? "Dark" : "Light"}</p>
      {children}
    </div>
  );
}

/** The same content in both themes, side by side from xl, stacked below. */
function Both({ children, className }: { children: (t: Theme) => React.ReactNode; className?: string }) {
  return <div className="grid gap-4 xl:grid-cols-2">{(["dark", "light"] as const).map((t) => <ThemePanel key={t} theme={t} className={className}>{children(t)}</ThemePanel>)}</div>;
}

function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-4">
      <SectionTitle id={`${id}-title`} title={title} description={description} className="mb-0" />
      {children}
    </section>
  );
}

function Cap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium text-subtle", className)}>{children}</p>;
}

// ---- Foundations ----------------------------------------------------------------------------------------------------

const SWATCHES: [string, string][] = [
  ["--background", "Canvas"], ["--sidebar", "Sidebar"], ["--surface", "fill-1, solid"], ["--popover", "Popover"], ["--toast", "Toast, tooltip"],
  ["--foreground", "Foreground"], ["--secondary", "Secondary 64%"], ["--subtle", "Subtle 53%"], ["--faint", "Faint"],
  ["--border", "Border 7.5%"], ["--border-input", "Input 10%"], ["--border-input-hover", "Input hover 16%"],
  ["--fill-0", "fill-0"], ["--fill-1", "fill-1"], ["--fill-150", "fill-150"],
  ["--primary", "Primary"], ["--accent", "Accent"], ["--accent-hover", "Accent hover"], ["--accent-soft", "Accent soft"], ["--accent-text", "Accent text"],
  ["--accent-tint", "Accent tint"], ["--accent-ring", "Accent ring"],
  ["--success", "Success"], ["--warning", "Warning"], ["--danger", "Danger"],
];

function Foundations() {
  return (
    <Section id="foundations" title="Foundations" description="Tokens (globals.css). A nested data-theme re-declares them, as these panels do.">
      <Both>
        {() => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {SWATCHES.map(([v, name]) => (
                <div key={v} className="flex min-w-0 items-center gap-2.5">
                  <span className="size-8 shrink-0 rounded-lg shadow-[0_0_0_1px_var(--border-input)]" style={{ background: `var(${v})` }} />
                  <span className="min-w-0"><span className="block truncate text-meta font-medium">{name}</span><span className="block truncate font-mono text-xs text-subtle">{v}</span></span>
                </div>
              ))}
            </div>
            <div>
              <Cap className="mb-2">Radius: 6, 7, 8, 10, 12, 16, 24, 26, full</Cap>
              <div className="flex flex-wrap items-end gap-3">
                {[6, 7, 8, 10, 12, 16, 24, 26, 999].map((r) => <span key={r} className="grid size-12 place-items-center bg-fill-1 text-xs text-secondary shadow-[0_0_0_1px_var(--border)]" style={{ borderRadius: r }}>{r === 999 ? "full" : r}</span>)}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {[["natural-xs", "shadow-natural-xs"], ["chart", "shadow-chart"], ["sheet", "shadow-sheet"], ["toast", "shadow-toast"]].map(([n, c]) => (
                <div key={n} className={cn("rounded-xl bg-background p-4 text-meta text-secondary", c)}>{n}</div>
              ))}
            </div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function TypeScale() {
  return (
    <Section id="type" title="Type" description="Inter 14/20 medium for the interface; Geist (display) for page titles and the home headline; Geist Mono for code and timers.">
      <Both>
        {() => (
          <div className="space-y-3">
            <p className="type-headline">What do you want to do today?</p><Cap>Home headline, display 28/36 400, .type-headline / text-3xl font-display</Cap>
            <p className="type-page-title">Dashboard</p><Cap>Page title, display 24/30 400, .type-page-title (h1 default)</Cap>
            <p className="type-section-title">Team today</p><Cap>Section title, 18/26 600, .type-section-title (h2 default)</Cap>
            <p className="type-dialog-title">Edit task</p><Cap>Dialog / sheet title, 18/26 500, .type-dialog-title</Cap>
            <p className="type-stat">312h 30m</p><Cap>Stat value, 24/30 700, .type-stat</Cap>
            <p className="type-metric">86</p><Cap>Metric value, 18/26 500, .type-metric</Cap>
            <p className="text-sm font-medium">Body, UI, buttons, nav, labels, 14/20 500</p>
            <p className="type-paragraph">Paragraphs and descriptions, 14/20 400, secondary, .type-paragraph</p>
            <p className="type-meta">Row subtitle and meta, 13/19.5 400, secondary, .type-meta / text-meta</p>
            <p className="type-metric-label">Metric label, 13/19.5 500, subtle, .type-metric-label</p>
            <p className="type-caption">Caption, badge, control label, 12/16 500, .type-caption / text-xs</p>
            <p className="type-tiny">Tiny badge, 10/16 600, .type-tiny / text-2xs</p>
            <p className="type-code">const total = hours.reduce(sum, 0);, .type-code</p>
            <p className="text-base font-normal">Long-form input text, 16/24 400, text-base</p>
          </div>
        )}
      </Both>
    </Section>
  );
}

// ---- Accents ----------------------------------------------------------------------------------------------------------

/** One accent rule: its name on the left, the parts that carry it on the right. */
function Rule({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0 lg:grid-cols-[160px_minmax(0,1fr)]">
      <Cap className="pt-1.5">{name}</Cap>
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">{children}</div>
    </div>
  );
}

const NAV_SAMPLE = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Messages", icon: MessageSquare, count: 3 },
  { label: "Tasks", icon: ListTodo },
];

function Accents() {
  const [tab, setTab] = React.useState<Record<Theme, string>>({ dark: "overview", light: "overview" });
  const [range, setRange] = React.useState<Record<Theme, string>>({ dark: "week", light: "week" });
  const [ask, setAsk] = React.useState<Record<Theme, string>>({ dark: "Plan my day", light: "" });
  return (
    <Section id="accents" title="Accents" description="Orange marks what is live, active, chosen or the one thing to do; never decoration. A typical screen has 3 to 6 small touches. Status colours keep their meaning. Rules: docs/design-system.md, “Accent rules”.">
      <Both>
        {(t) => (
          <div className="space-y-4">
            <Rule name="Navigation">
              <ul className="w-52 space-y-1 rounded-xl bg-sidebar p-2" aria-label={`Sample navigation (${t})`}>
                {NAV_SAMPLE.map(({ label, icon: Icon, active, count }) => (
                  <li key={label}>
                    <a href="#accents" aria-current={active ? "page" : undefined} className={cn("flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors duration-75 [&>svg]:size-[18px]", active ? "bg-fill-1 text-foreground [&>svg]:text-accent" : "text-secondary hover:bg-fill-1 hover:text-foreground")}>
                      <Icon aria-hidden /><span className="min-w-0 flex-1 truncate">{label}</span>{count ? <CountPill count={count} tone="attention" /> : null}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="min-w-0 flex-1 space-y-3">
                <Tabs label={`Accent tabs (${t})`} value={tab[t]} onChange={(v) => setTab({ ...tab, [t]: v })} tabs={[{ label: "Overview", value: "overview" }, { label: "Reviews", value: "reviews", count: 2, attention: true }, { label: "All tasks", value: "all", count: 48 }]} />
                <Cap>Active icon orange (label foreground); attention counts orange, plain totals grey; the active tab&apos;s 1.5px underline orange.</Cap>
              </div>
            </Rule>
            <Rule name="Counts and badges">
              <span className="flex items-center gap-1.5 text-sm">All tasks <CountPill count={48} /></span>
              <span className="flex items-center gap-1.5 text-sm">Unread <CountPill count={3} tone="attention" /></span>
              <Badge tone="attention">2 waiting for you</Badge>
              <span className="flex items-center gap-1.5 text-sm">Docs <NewBadge /></span>
            </Rule>
            <Rule name="The standout action">
              <Button variant="accent"><Plus aria-hidden />New document</Button>
              <Button variant="secondary">Import</Button>
              <Button>Save</Button>
              <Cap className="basis-full">One per screen at most; every other primary stays white.</Cap>
            </Rule>
            <Rule name="Live and now">
              <span className="inline-flex items-center gap-2"><StatusDot tone="live" label="Timer running" /><span className="font-mono text-sm tabular-nums text-accent-text">01:24:09</span></span>
              <LiveIndicator>Recording</LiveIndicator>
              <span className="inline-flex items-center gap-2 text-xs font-medium text-secondary"><StatusDot tone="live" />Live, last sync 10:42</span>
              <span className="inline-flex items-center gap-2 text-xs font-medium text-secondary"><StatusDot tone="success" />Working (green stays green)</span>
            </Rule>
            <Rule name="Progress">
              <div className="w-44 space-y-1.5"><ProgressBar value={3} max={5} label={`Setup progress (${t})`} valueText="3 of 5 steps done" /><Cap>3 of 5 done</Cap></div>
              <ProgressArc percent={60} size={36} />
              <ProgressArc percent={100} size={36} />
              <div className="w-44"><Slider aria-label={`Percentage done (${t})`} defaultValue={40} step={5} /></div>
            </Rule>
            <Rule name="Choice and completion">
              <Checkbox defaultChecked>Sent the invoice</Checkbox>
              <Radio name={`acc-radio-${t}`} defaultChecked>Only my team</Radio>
              <Segmented aria-label={`Range (${t})`} value={range[t]} onChange={(v) => setRange({ ...range, [t]: v })} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
              <span className="inline-flex items-center gap-2"><Switch aria-label={`Switch stays white (${t})`} defaultChecked /><Cap>switches stay white</Cap></span>
            </Rule>
            <Rule name="Selected row, sub-nav">
              <ul className="w-full max-w-xs">
                <ListRow active onClick={() => {}} leading={<ToolSquare><FileText /></ToolSquare>} title="Weekly report" subtitle="Open now" />
                <ListRow onClick={() => {}} leading={<ToolSquare><FileText /></ToolSquare>} title="Brand deck" subtitle="Edited yesterday" />
              </ul>
              <nav aria-label={`Sample sub-navigation (${t})`} className="w-44 space-y-0.5">
                <SubNavItem active icon={<Settings aria-hidden />}>General</SubNavItem>
                <SubNavItem icon={<Users aria-hidden />}>People</SubNavItem>
                <SubNavItem icon={<CreditCard aria-hidden />}>Billing</SubNavItem>
              </nav>
            </Rule>
            <Rule name="Charts">
              <div className="w-full max-w-sm"><BarChart title={`Hours by day (${t})`} labels={DAYS} values={[6, 7.5, 8, 7, 3.5, 0, 0]} highlight={4} height={120} /></div>
              <Cap>Today (the highlight series) orange, the rest grey.</Cap>
            </Rule>
            <Rule name="Brenda">
              <div className="w-full max-w-md"><PromptInputBox value={ask[t]} onValueChange={(v) => setAsk({ ...ask, [t]: v })} onSend={() => setAsk({ ...ask, [t]: "" })} label={`Accent prompt (${t})`} placeholder="Ask Brenda…" /></div>
              <ToolTile icon={<ListOrdered aria-hidden />} label="Plan my day" active />
              <Cap className="basis-full">Focus the pill: its ring turns orange. Send is orange with text, grey when empty. A tool tile&apos;s icon turns orange on hover and focus.</Cap>
            </Rule>
            <Rule name="Links, empty states">
              <p className="type-paragraph max-w-xs">Check the <a href="#accents" className="link-inline">working hours</a> before you change a timesheet.</p>
              <div className="rounded-xl border border-border"><EmptyState compact icon={Inbox} title="No messages yet" description="When someone writes, it shows here." /></div>
            </Rule>
          </div>
        )}
      </Both>
      <Both>
        {(t) => <SampleScreen theme={t} />}
      </Both>
    </Section>
  );
}

/** A sample screen with five touches of orange: the tab underline, the running timer, the standout Start, a ticked to-do and progress. */
function SampleScreen({ theme }: { theme: Theme }) {
  const [tab, setTab] = React.useState("today");
  return (
    <div className="space-y-4">
      <Cap>Sample screen, 5 touches: tab underline, running timer, the one orange button, a ticked to-do, today&apos;s progress.</Cap>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-page-title">My Day</p>
        <Button size="sm" variant="secondary"><Plus aria-hidden />Add a to-do</Button>
      </div>
      <Tabs label={`My Day (${theme})`} value={tab} onChange={setTab} tabs={[{ label: "Today", value: "today", count: 4 }, { label: "This week", value: "week" }, { label: "Done", value: "done" }]} />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Today&apos;s progress</span><span className="text-meta font-normal tabular-nums text-secondary">1 of 4 done</span></div>
        <ProgressBar value={1} max={4} label={`Today's progress (${theme})`} valueText="1 of 4 to-dos done" />
      </div>
      <ul className="space-y-0.5">
        <li className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2">
          <StatusDot tone="live" label="Timer running" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Homepage redesign</p><p className="text-meta font-normal text-secondary">Working for <span className="font-mono tabular-nums text-accent-text">01:24:09</span></p></div>
          <Button size="sm" variant="secondary"><Pause aria-hidden />Pause</Button>
        </li>
        <li className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2">
          <span className="size-2 shrink-0 rounded-full bg-faint" aria-hidden />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Review the brand deck</p><p className="text-meta font-normal text-secondary">Next, due 15:00</p></div>
          <Button size="sm" variant="accent">Start</Button>
        </li>
        <li className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2">
          <Checkbox aria-label="Send the invoice, done" defaultChecked />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-secondary line-through decoration-[var(--faint)]">Send the invoice</p><p className="text-meta font-normal text-secondary">Done at 09:40</p></div>
        </li>
      </ul>
    </div>
  );
}

// ---- Buttons ----------------------------------------------------------------------------------------------------------

const VARIANTS = ["primary", "secondary", "ghost", "subtle", "accent", "danger", "destructive", "link"] as const;
const HOVER: Record<(typeof VARIANTS)[number], string> = {
  primary: "bg-primary-hover", secondary: "border-border-input-hover bg-[color-mix(in_srgb,var(--foreground)_2.4%,var(--background))]", ghost: "bg-fill-1 text-foreground",
  subtle: "bg-fill-150", accent: "bg-accent-hover", danger: "border-danger/40 bg-danger/10", destructive: "bg-danger/90", link: "text-foreground underline",
};
const FOCUS = "outline-2 outline-offset-2 outline-[var(--ring)]";

function Buttons() {
  return (
    <Section id="buttons" title="Buttons" description="Primary is white (one per view); secondary is the outline; accent (orange, near-black text) is the one standout action, at most once per screen.">
      <Both>
        {() => (
          <div className="space-y-6">
            <div className="overflow-x-auto">
              <div className="grid min-w-[620px] grid-cols-[88px_repeat(5,minmax(0,1fr))] items-center gap-x-3 gap-y-3">
                <span />{["Default", "Hover", "Focus", "Disabled", "Loading"].map((s) => <Cap key={s}>{s}</Cap>)}
                {VARIANTS.map((v) => (
                  <React.Fragment key={v}>
                    <Cap>{v}</Cap>
                    <div><Button variant={v}>Save</Button></div>
                    <div><Button variant={v} className={HOVER[v]}>Save</Button></div>
                    <div><Button variant={v} className={FOCUS}>Save</Button></div>
                    <div><Button variant={v} disabled>Save</Button></div>
                    <div><Button variant={v} loading>Saving…</Button></div>
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Cap>Sizes: xs 28, sm 32, md 36, lg 40, tile 56</Cap>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="xs" variant="secondary">Extra small</Button>
                <Button size="sm" variant="secondary">Small</Button>
                <Button size="md" variant="secondary">Medium</Button>
                <Button size="lg" variant="secondary">Large</Button>
                <Button size="sm"><Plus aria-hidden />New task</Button>
                <Button size="sm" variant="secondary">Documentation<ArrowUpRight aria-hidden /></Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2"><Button size="tile" variant="secondary"><ListTodo aria-hidden />Plan my day</Button><Button size="tile" variant="secondary"><Clock aria-hidden />Clock in</Button></div>
              <Cap>Icon buttons: ghost 28, 32, 36, outline 40, round 36; EditButton</Cap>
              <div className="flex flex-wrap items-center gap-2">
                <IconButton size="xs" aria-label="Copy"><Copy aria-hidden /></IconButton>
                <IconButton aria-label="Notifications"><Bell aria-hidden /></IconButton>
                <IconButton size="md" aria-label="Settings"><Settings aria-hidden /></IconButton>
                <IconButton aria-label="More actions" className="bg-fill-1 text-foreground"><Ellipsis aria-hidden /></IconButton>
                <IconButton variant="outline" aria-label="Open"><ArrowUpRight aria-hidden /></IconButton>
                <IconButton variant="round" aria-label="Add"><Plus aria-hidden /></IconButton>
                <IconButton aria-label="Disabled" disabled><Trash2 aria-hidden /></IconButton>
                <EditButton />
                <EditButton iconOnly label="Edit the title" />
              </div>
            </div>
          </div>
        )}
      </Both>
    </Section>
  );
}

// ---- Inputs ----------------------------------------------------------------------------------------------------------

function Inputs() {
  return (
    <Section id="inputs" title="Inputs" description="h36 r10 px12; 10% hairline, 16% on hover; focus = foreground border + 0.5px ring. Labels 14/20 medium, 6px above.">
      <Both>
        {(t) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={`in-name-${t}`} description="As your team sees it."><Input id={`in-name-${t}`} placeholder="Ada Lovelace" /></Field>
            <Field label="Email" htmlFor={`in-email-${t}`} error="Enter an email like name@company.com."><Input id={`in-email-${t}`} defaultValue="ada@" /></Field>
            <div><Cap className="mb-1.5">Hover</Cap><Input aria-label="Hovered" className="border-border-input-hover" defaultValue="Hovered" /></div>
            <div><Cap className="mb-1.5">Focus</Cap><Input aria-label="Focused" className="border-foreground shadow-[0_0_0_0.5px_var(--foreground)]" defaultValue="Focused" /></div>
            <div><Cap className="mb-1.5">Disabled</Cap><Input aria-label="Disabled" disabled defaultValue="Disabled" /></div>
            <Field label="Team" htmlFor={`in-team-${t}`} hint="Optional"><Select id={`in-team-${t}`} defaultValue="design"><option value="design">Design</option><option value="eng">Engineering</option></Select></Field>
            <div className="sm:col-span-2"><Field label="Notes" htmlFor={`in-notes-${t}`}><Textarea id={`in-notes-${t}`} placeholder="What should the team know?" /></Field></div>
            <div className="sm:col-span-2 space-y-2">
              <Cap>Sizes: xs 24, sm 32, md 36, lg 40 (search, toolbars), adorned</Cap>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Extra small" fieldSize="xs" className="w-28" placeholder="xs" />
                <Input aria-label="Small" fieldSize="sm" className="w-32" placeholder="sm" />
                <Input aria-label="Medium" className="w-36" placeholder="md" />
                <InputAdorned aria-label="Search" fieldSize="lg" className="w-64" prefix={<Search aria-hidden />} placeholder="Search everything…" />
                <InputAdorned aria-label="Rate" className="w-36" prefix="£" suffix="/h" placeholder="40" />
              </div>
            </div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Selection() {
  return (
    <Section id="selection" title="Selection" description="Switch 36×20 (on = foreground, stays white); checkbox and radio 16px, orange when checked; segmented (fill-1 r10 p2; items h28 r7), an orange dot on the chosen item, a status colour instead on a status choice.">
      <Both>
        {(t) => (
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1">
              <Switch defaultChecked hint="Brenda writes your daily summary at 17:00.">Daily summary</Switch>
              <Switch hint="Off until an owner turns it on.">Screen recording</Switch>
              <Switch disabled hint="Your plan does not include it.">Exports</Switch>
              <div className="flex items-center gap-3 pt-2"><Switch aria-label="Bare on" defaultChecked /><Switch aria-label="Bare off" /><Cap>bare, for tables</Cap></div>
            </div>
            <div className="space-y-3">
              <Checkbox defaultChecked hint="Shown on their profile.">Share my email</Checkbox>
              <Checkbox>Remind me tomorrow</Checkbox>
              <Checkbox disabled>Unavailable</Checkbox>
              <div role="radiogroup" aria-label="Visibility" className="space-y-2 pt-1">
                <Radio name={`vis-${t}`} defaultChecked>Everyone in the workspace</Radio>
                <Radio name={`vis-${t}`}>Only my team</Radio>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Segmented name={`seg-${t}`} aria-label="Range" defaultValue="week" options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
              <div><Segmented name={`seg2-${t}`} aria-label="Status" defaultValue="ok" options={[{ value: "ok", label: "Approved", tone: "success" }, { value: "wait", label: "Waiting", tone: "warning" }, { value: "no", label: "Rejected", tone: "danger" }]} /></div>
            </div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function TabsDemo() {
  const [a, setA] = React.useState<Record<Theme, string>>({ dark: "overview", light: "overview" });
  const [b, setB] = React.useState<Record<Theme, string>>({ dark: "all", light: "all" });
  return (
    <Section id="tabs" title="Tabs" description="Underline (default): 14/20 medium, 24px apart, a 1.5px orange underline that slides, on a hairline; counts grey, or orange with attention. Pills: the sub-nav look in a row, neutral.">
      <Both>
        {(t) => (
          <div className="space-y-6">
            <Tabs label="Underline tabs" value={a[t]} onChange={(v) => setA({ ...a, [t]: v })} tabs={[{ label: "Overview", value: "overview" }, { label: "Hours", value: "hours" }, { label: "Attendance", value: "attendance", count: 2, attention: true }, { label: "Blocked", value: "blocked", count: 14 }]} />
            <Tabs label="Pill tabs" variant="pills" value={b[t]} onChange={(v) => setB({ ...b, [t]: v })} tabs={[{ label: "All", value: "all" }, { label: "Mine", value: "mine", count: 5 }, { label: "Done", value: "done" }]} />
          </div>
        )}
      </Both>
    </Section>
  );
}

function Badges() {
  return (
    <Section id="badges" title="Badges" description="Pills h20 12/16; status tones as a 12% wash; accent (alias attention) and New are orange. Counts: grey totals, orange attention. Mono chips and keys.">
      <Both>
        {() => (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Neutral</Badge><Badge tone="accent">Accent</Badge><Badge tone="attention">Attention</Badge><Badge tone="success" dot>Running</Badge><Badge tone="warning" dot>Paused</Badge>
              <Badge tone="danger" dot>Blocked</Badge><Badge tone="info">To do</Badge><Badge size="lg">Large</Badge><Badge size="sm">Small</Badge><NewBadge />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm">Tasks <CountPill count={12} /></span>
              <span className="flex items-center gap-1.5 text-sm">Inbox <CountPill count={240} /></span>
              <span className="flex items-center gap-1.5 text-sm">Unread <CountPill count={3} tone="attention" /></span>
              <MonoChip>BR-1042</MonoChip><MonoChip>3</MonoChip>
              <span className="flex gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span><Kbd>Esc</Kbd>
            </div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Cards() {
  return (
    <Section id="cards" title="Cards" description="Section r24 p24 fill-0; panel r16 p20 (most cards); stat r12 p20; tint (accent 10%, rare); plain (no padding).">
      <Both>
        {() => (
          <div className="grid gap-3 sm:grid-cols-2">
            <SectionCard className="sm:col-span-2"><CardHeader title="Section card" description="A big section of a page." action={<Button size="sm" variant="secondary">Manage</Button>} className="mb-0" /></SectionCard>
            <Card><CardHeader size="sm" title="Panel" description="The default card." className="mb-2" /><p className="type-paragraph">Hairline, canvas colour, the chart shadow.</p></Card>
            <Card variant="stat"><p className="text-sm font-medium text-secondary">Stat surface</p><p className="type-stat mt-1">42</p></Card>
            <Card variant="tint"><p className="text-sm font-medium">Trial: 9 days left</p><p className="text-meta font-normal text-secondary">The rare accent-tinted notice.</p></Card>
            <Card variant="plain" className="overflow-hidden"><div className="border-b border-border px-5 py-3 text-sm font-medium">Plain</div><p className="px-5 py-3 type-paragraph">No padding: lists and tables run to the edges.</p></Card>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Stats() {
  return (
    <Section id="stats" title="Stat cards" description="Label 14/20 secondary over the value 24/30 bold; an icon square or an outline action top right; rows, hint and actions below. Ledger is a row of them.">
      <Both>
        {() => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Hours this week" value="312h 30m" hint="8% more than last week" icon={<Hourglass />} />
              <StatCard label="Blocked tasks" value="3" tone="danger" action={<IconButton variant="outline" aria-label="Open blocked tasks"><TriangleAlert aria-hidden /></IconButton>} actions={<><Button variant="secondary" size="xs">Review</Button><Button variant="ghost" size="xs">Dismiss</Button></>} />
              <StatCard label="Working now" value="14 of 18" rows={[{ label: "Working", value: 14, share: "78%", tone: "success" }, { label: "Away", value: 3, share: "17%", tone: "neutral" }, { label: "Late", value: 1, share: "5%", tone: "danger" }]} />
              <StatCard label="Focus time" value="61%" hint={<span className="flex items-center gap-2">Last 7 days <Sparkline label="Focus time, last 7 days" values={[58, 63, 60, 66, 59, 40, 61]} width={72} height={18} /></span>} />
            </div>
            <Ledger items={[{ label: "On time", value: "92%" }, { label: "Late", value: 4, tone: "danger" }, { label: "Overtime", value: "6h" }, { label: "Absences", value: 1, note: "Grace, Friday" }]} />
          </div>
        )}
      </Both>
    </Section>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Analytics() {
  return (
    <Section id="analytics" title="Analytics card" description="A strip of metric tabs (p16, fill-0, 10% line; chosen = canvas + 1.5px orange line) over the chart, whose highlight series is orange. MetricStrip also stands alone.">
      <Both>
        {() => (
          <div className="space-y-4">
            <AnalyticsCard label="This week" title="Hours and output" description="All teams"
              toolbar={<FilterSelect label="Period" options={[{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }]} defaultValue="7" />}
              metrics={[
                { key: "hours", label: "Hours logged", value: "312.5", hint: "+8%", content: <AreaChart title="Hours by day" labels={DAYS} series={[{ label: "This week", values: [52, 61, 58, 66, 49, 14, 12] }, { label: "Last week", values: [48, 55, 60, 52, 47, 9, 4] }]} /> },
                { key: "tasks", label: "Tasks done", value: "86", content: <BarChart title="Tasks by day" labels={DAYS} values={[12, 18, 15, 21, 14, 3, 3]} highlight={3} /> },
                { key: "late", label: "Late clock-ins", value: "4", content: <BarChart title="Late by day" labels={DAYS} values={[0, 0, 0, 0, 0, 0, 0]} empty="Nobody was late." /> },
              ]} />
            <div className="overflow-hidden rounded-2xl border border-border"><MetricStrip value="b" metrics={[{ key: "a", label: "Credits used", value: "12,480" }, { key: "b", label: "Sessions", value: "1,204" }, { key: "c", label: "People", value: "18" }]} /></div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Filters() {
  return (
    <Section id="filters" title="Filters" description="Filter control: min-h 32, r10, fill-0, p 4/6: a 12/16 subtle label and an h24 outline trigger. FilterSelect autoSubmit submits its GET form.">
      <Both>
        {(t) => (
          <FilterBar>
            <FilterSelect id={`f-team-${t}`} label="Team" options={[{ value: "all", label: "All teams" }, { value: "design", label: "Design" }]} defaultValue="all" />
            <FilterSelect id={`f-status-${t}`} label="Status" options={[{ value: "any", label: "Any" }, { value: "blocked", label: "Blocked" }]} defaultValue="any" />
            <FilterControl label="From"><DatePicker size="xs" aria-label="From" defaultValue="2026-10-01" /></FilterControl>
            <Button size="xs" variant="ghost">Clear</Button>
          </FilterBar>
        )}
      </Both>
    </Section>
  );
}

/** Brenda's asks exactly as her home shows them (src/components/app/brenda-home.tsx), for the spacing check. */
const LEAD_ASKS = [
  { icon: Users, label: "Who's working" }, { icon: ClipboardCheck, label: "Week summary" }, { icon: MessageSquareReply, label: "Chase work" },
  { icon: FileText, label: "Write a doc" }, { icon: CircleAlert, label: "Who's late" },
];
const WORKER_ASKS = [
  { icon: ListOrdered, label: "Plan my day" }, { icon: CalendarCheck, label: "Due today" }, { icon: MessageSquareReply, label: "Follow up" },
  { icon: FileText, label: "Write a doc" }, { icon: AlarmClock, label: "Remind me" },
];

function Tiles() {
  return (
    <Section id="tiles" title="Tool tiles and quick links" description="Tool tile: a 40×40 r12 square (20px icon), the label 10px under it, at least 81px wide; a r16 fill-1 plate and an orange icon on hover. ToolTileRow: equal columns as wide as the widest label, so the squares are evenly spaced; one row when it fits, else a balanced grid of three. Quick link: h56 p16 r12 outline.">
      <Card className="space-y-8">
        <div><Cap className="mb-4 text-center">Brenda&apos;s home, team lead: five equal columns (the widest label, “Week summary”, sets them), 16px apart</Cap>
          <ToolTileRow label="Ask Brenda, team lead">{LEAD_ASKS.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} />)}</ToolTileRow></div>
        <div><Cap className="mb-4 text-center">Staff: the same rule, narrower columns (“Plan my day”)</Cap>
          <ToolTileRow label="Ask Brenda, staff">{WORKER_ASKS.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} />)}</ToolTileRow></div>
      </Card>
      <Both>
        {(t) => (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-center gap-8">
              <div className="w-[337px] max-w-full rounded-xl border border-dashed border-border-input py-4"><Cap className="mb-3 text-center">A 375px phone: three columns, the last row centred</Cap>
                <ToolTileRow label={`Ask Brenda, phone (${t})`}>{LEAD_ASKS.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} />)}</ToolTileRow></div>
              <div className="w-[300px] max-w-full rounded-xl border border-dashed border-border-input py-4"><Cap className="mb-3 text-center">Below 332px: two columns</Cap>
                <ToolTileRow label={`Ask Brenda, small phone (${t})`}>{LEAD_ASKS.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} />)}</ToolTileRow></div>
            </div>
            <ToolTileRow label={`Six tiles (${t})`}>
              <ToolTile icon={<ListTodo />} label="Plan my day" />
              <ToolTile icon={<Clock />} label="Clock in" />
              <ToolTile icon={<SquareCheckBig />} label="New task" active />
              <ToolTile icon={<MessageSquare />} label="Message" />
              <ToolTile icon={<FileText />} label="Write a doc" />
              <ToolTile icon={<CalendarClock />} label="Book leave" />
            </ToolTileRow>
            <div className="grid gap-2 sm:grid-cols-2">
              <QuickLink icon={<Users />} label="People" href="#tiles" />
              <QuickLink icon={<CalendarClock />} label="Attendance" href="#tiles" trailing={<CountPill count={2} tone="attention" />} />
            </div>
            <div className="flex flex-wrap items-center gap-3"><ToolSquare><BrendaGlyph /></ToolSquare><ToolSquare tone="accent"><Inbox /></ToolSquare><Cap>ToolSquare on its own (ListRow thumbs, IconTile); tone=&quot;accent&quot; for the rare live or new thumb</Cap></div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Lists() {
  return (
    <Section id="lists" title="Lists" description="ListRow: 64px, a 40px thumb, title 14/20 semibold, subtitle 13 secondary, meta with a count; separated by space, never lines; the selected row (active) has the 2px orange marker. SubNavItem: the 32px sub-nav item, the chosen one with the marker.">
      <Both>
        {(t) => (
          <div className="space-y-5">
            <ul>
              <ListRow href="#lists" leading={<Avatar profileId={`l1-${t}`} name="Ada Lovelace" size={40} />} title="Ada Lovelace" subtitle="Homepage redesign" meta={<>Working for 2h 10m <CountPill count={3} /></>} trailing={<Badge tone="success" dot>Working</Badge>} />
              <ListRow onClick={() => {}} leading={<ToolSquare><FileText /></ToolSquare>} title="Weekly report draft" subtitle="Edited 12 minutes ago" trailing={<Ellipsis className="size-4" aria-hidden />} />
              <ListRow active leading={<ToolSquare><BrendaGlyph /></ToolSquare>} title="Brenda" subtitle="Your day is planned" trailing="09:12" />
            </ul>
            <div className="flex flex-wrap gap-8">
              <nav aria-label={`Settings sections (${t})`} className="w-48 space-y-0.5">
                <Cap className="mb-1.5">SubNavItem</Cap>
                <SubNavItem active icon={<Settings aria-hidden />}>General</SubNavItem>
                <SubNavItem icon={<Users aria-hidden />} count={2} attention>People</SubNavItem>
                <SubNavItem icon={<Folder aria-hidden />} count={14}>Projects</SubNavItem>
                <SubNavItem icon={<CreditCard aria-hidden />}>Billing</SubNavItem>
              </nav>
              <div className="w-48 space-y-0.5">
                <Cap className="mb-1.5">.subnav-item, hand-built</Cap>
                <a href="#lists" className="subnav-item" aria-current="page"><Folder aria-hidden />All docs</a>
                <a href="#lists" className="subnav-item"><Folder aria-hidden />Shared with me</a>
              </div>
            </div>
            <div><Cap className="mb-1">RowList (dense, v3 props)</Cap><RowList><Row title="Send the invoice" meta="Due today" trailing="17:00" /><Row title="Review the brand deck" meta="Waiting for David" trailing="Fri" href="#lists" /></RowList></div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Tables() {
  const rows = [["Ada Lovelace", "Design", "success", "Working", "6h 40m"], ["David Okafor", "Team lead", "warning", "In a meeting", "5h 05m"], ["Grace Hopper", "Engineering", "neutral", "Away", "3h 12m"]] as const;
  return (
    <Section id="tables" title="Tables" description="No outer border; 36px head on a hairline; 48px rows, no lines, no hover; first column flush left; a ghost “…” for row actions.">
      <Both>
        {(t) => (
          <div className="space-y-6">
            <DataTable caption="People">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th className="text-right">Hours</th><th>Recording</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map(([name, role, tone, status, hours], i) => (
                  <tr key={name}>
                    <td className="font-medium">{name}</td><td className="text-secondary">{role}</td><td><Badge tone={tone} dot>{status}</Badge></td>
                    <td className="text-right tabular-nums">{hours}</td><td><Switch aria-label={`Recording for ${name} (${t})`} defaultChecked={i !== 1} /></td>
                    <td className="w-10 text-right"><IconButton aria-label={`Actions for ${name}`}><Ellipsis aria-hidden /></IconButton></td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Card variant="plain"><DataTable caption="In a card"><thead><tr><th>In a plain card</th><th className="text-right">Value</th></tr></thead><tbody><tr><td>Outer columns take 20px</td><td className="text-right tabular-nums">20</td></tr></tbody></DataTable></Card>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Feedback() {
  return (
    <Section id="feedback" title="Feedback" description="Alerts; empty states (the icon in an orange-tinted square; errors red, a locked state grey); skeletons, toasts; progress fills in orange and turns green when done.">
      <Both>
        {() => (
          <div className="space-y-5">
            <div className="grid gap-2">
              <Alert title="Heads up">Recording starts only when the person presses Record.</Alert>
              <Alert tone="success" title="Saved">Your schedule is up to date.</Alert>
              <Alert tone="warning" title="Trial ends Friday" action={<Button size="xs" variant="secondary">See plans</Button>}>Choose a plan to keep your reports.</Alert>
              <Alert tone="danger">That did not go through. Check your connection and try again.</Alert>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border"><EmptyState icon={Inbox} title="No messages yet" description="When someone writes to you, it shows here." action={<Button size="sm" variant="secondary">Write a message</Button>} /></div>
              <div className="rounded-xl border border-border"><EmptyState compact icon3d="card-check" title="Nothing due today" description="Enjoy the quiet." /></div>
              <div className="rounded-xl border border-border"><EmptyState compact tone="danger" icon={TriangleAlert} title="Something went wrong" description="ErrorState: status wins over accent." /></div>
              <div className="rounded-xl border border-border"><EmptyState compact tone="neutral" icon={Settings} title="Permission denied" description="PermissionDenied: a quiet grey square." /></div>
            </div>
            <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full rounded-xl" /></div>
            <div className="flex flex-wrap gap-3 [&>*]:max-w-full">
              <ToastCard title="Task created" description="Brenda added it to your day." tone="success" />
              <ToastCard title="Clocked out" tone="neutral" />
              <ToastCard title="Upload failed" description="The file is larger than 50 MB." tone="danger" />
            </div>
            <div className="flex flex-wrap items-center gap-4"><ProgressArc percent={0} /><ProgressArc percent={45} /><ProgressArc percent={72} tone="neutral" /><ProgressArc percent={100} /><Button variant="secondary" loading>Uploading…</Button></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Cap>ProgressBar 3 of 5</Cap><ProgressBar value={3} max={5} label="Setup progress" valueText="3 of 5 steps done" /></div>
              <div className="space-y-1.5"><Cap>Done (green)</Cap><ProgressBar value={5} max={5} label="Setup done" /></div>
              <div className="space-y-1.5"><Cap>Slider</Cap><Slider aria-label="Percentage done" defaultValue={65} step={5} /></div>
            </div>
          </div>
        )}
      </Both>
    </Section>
  );
}

function Overlays() {
  const [sheet, setSheet] = React.useState(false);
  const [dialog, setDialog] = React.useState(false);
  return (
    <Section id="overlays" title="Overlays" description="Live in the page theme: the right sheet (512px), a centred dialog (440px), a confirm, a menu, a popover, tooltips (hover an icon button) and toasts.">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
          <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
          <ConfirmButton variant="danger" title="Delete this task?" description="It leaves everyone's lists. This cannot be undone." confirmLabel="Delete task" pendingLabel="Deleting…" onConfirm={() => new Promise((r) => setTimeout(r, 800))}>Delete…</ConfirmButton>
          <Menu label="Task actions" trigger={<Button variant="secondary">Menu</Button>}>
            <MenuLabel>Task</MenuLabel>
            <MenuItem icon={<Pencil />} kbd="E">Edit</MenuItem>
            <MenuItem icon={<Copy />} kbd="⌘D">Duplicate</MenuItem>
            <MenuItem icon={<Clock />} checked>Track time</MenuItem>
            <MenuItem icon={<Users />} disabled>Reassign</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} tone="danger">Delete</MenuItem>
          </Menu>
          <Popover label="Quick note" width={300} trigger={<Button variant="secondary">Popover</Button>}>
            {(close) => (
              <div className="space-y-3">
                <Field label="Quick note" htmlFor="pop-note"><Input id="pop-note" placeholder="Remember to…" /></Field>
                <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={close}>Cancel</Button><Button size="sm" onClick={close}>Save</Button></div>
              </div>
            )}
          </Popover>
          <IconButton aria-label="Tooltips come from the accessible name"><Bell aria-hidden /></IconButton>
          <IconButton aria-label="Settings" data-tip="Workspace settings"><Settings aria-hidden /></IconButton>
          <Button variant="ghost" onClick={() => notify("Task created", { description: "Brenda added it to your day.", tone: "success" })}>Toast</Button>
          <Button variant="ghost" onClick={() => notify("Upload failed", { description: "The file is larger than 50 MB.", tone: "danger" })}>Error toast</Button>
        </div>
      </Card>
      <Both>
        {() => (
          <div className="flex flex-wrap items-start gap-6">
            <div className="popover-surface w-56 p-1" aria-hidden>
              <div className="menu-label">Static menu</div>
              <div className="menu-item"><Pencil />Edit<span className="kbd ml-auto">E</span></div>
              <div className="menu-item" data-active><Copy />Duplicate (hover)</div>
              <div className="menu-separator" />
              <div className="menu-item" data-tone="danger"><Trash2 />Delete</div>
            </div>
            <div className="space-y-3">
              <span className="tip static inline-block transform-none animate-none">Workspace settings</span>
              <div className="card-panel w-64 p-0" aria-hidden>
                <div className="px-5 pb-2 pt-5"><p className="type-dialog-title">Edit task</p><p className="mt-1 text-sm font-medium text-secondary">Sheet and dialog anatomy.</p></div>
                <div className="flex justify-end gap-2 px-5 pb-5 pt-3"><Button size="sm" variant="secondary" tabIndex={-1}>Cancel</Button><Button size="sm" tabIndex={-1}>Save</Button></div>
              </div>
            </div>
          </div>
        )}
      </Both>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Edit task" description="Changes are saved for everyone on the task."
        footer={<><Button variant="secondary" onClick={() => setSheet(false)}>Cancel</Button><Button onClick={() => setSheet(false)}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Title" htmlFor="sheet-title"><Input id="sheet-title" defaultValue="Homepage redesign" /></Field>
          <Field label="Due" htmlFor="sheet-due"><DatePicker id="sheet-due" mode="datetime" defaultValue="2026-10-09T17:00" /></Field>
          <Field label="Estimate" htmlFor="sheet-est"><DurationPicker id="sheet-est" defaultValue={210} /></Field>
          <Field label="Notes" htmlFor="sheet-notes"><Textarea id="sheet-notes" placeholder="Anything the assignee should know" /></Field>
          <Switch defaultChecked hint="Brenda reminds the assignee the day before.">Reminder</Switch>
        </div>
      </Sheet>
      <Dialog open={dialog} onClose={() => setDialog(false)} title="Rename the team" footer={<><Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button><Button onClick={() => setDialog(false)}>Rename</Button></>}>
        <Field label="Name" htmlFor="dlg-name"><Input id="dlg-name" defaultValue="Design" /></Field>
      </Dialog>
    </Section>
  );
}

function Pickers() {
  return (
    <Section id="pickers" title="Pickers" description="Field triggers that open a calendar, hours and minutes, or a length; the choice is the inverted primary. Pop-ups follow the page theme.">
      <Both>
        {(t) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor={`pk-d-${t}`}><DatePicker id={`pk-d-${t}`} defaultValue="2026-10-06" /></Field>
            <Field label="Month" htmlFor={`pk-m-${t}`}><DatePicker id={`pk-m-${t}`} mode="month" defaultValue="2026-10" /></Field>
            <Field label="Start" htmlFor={`pk-t-${t}`}><TimePicker id={`pk-t-${t}`} defaultValue="09:00" /></Field>
            <Field label="Estimate" htmlFor={`pk-du-${t}`}><DurationPicker id={`pk-du-${t}`} /></Field>
            <Field label="Small" htmlFor={`pk-s-${t}`}><DatePicker id={`pk-s-${t}`} size="sm" placeholder="Any day" /></Field>
            <Field label="Invalid" htmlFor={`pk-e-${t}`} error="Pick a date after today."><DatePicker id={`pk-e-${t}`} defaultValue="2026-10-01" /></Field>
          </div>
        )}
      </Both>
    </Section>
  );
}

/** Brenda's quick asks as they sit above her hero box: chips that fill the box (label, then a small icon). */
const HERO_CHIPS = [
  { icon: CalendarCheck, label: "What's due today?", prompt: "What's waiting for me today?" },
  { icon: AlarmClock, label: "Set a reminder", prompt: "Remind me to " },
  { icon: Clock, label: "Start a timer", prompt: "Start the timer on " },
];

function Prompt() {
  const [text, setTextFor] = React.useState<Record<Theme, string>>({ dark: "", light: "" });
  const [recFor, setRecFor] = React.useState<Record<Theme, boolean>>({ dark: false, light: false });
  const [hero, setHeroFor] = React.useState<Record<Theme, string>>({ dark: "", light: "" });
  const [heroRec, setHeroRec] = React.useState<Record<Theme, boolean>>({ dark: false, light: false });
  const [small, setSmallFor] = React.useState<Record<Theme, string>>({ dark: "", light: "" });
  const rec = recFor.dark || recFor.light;
  const [level, setLevel] = React.useState(0.2);
  React.useEffect(() => {
    if (!rec) return;
    const id = window.setInterval(() => setLevel(0.25 + Math.abs(Math.sin(Date.now() / 300)) * 0.6), 120);
    return () => window.clearInterval(id);
  }, [rec]);
  return (
    <Section id="prompt" title="Prompt" description="The prompt pill (the drawer): min-h 52, r26, solid fill-1, 16/24 text, round 36px actions; an orange ring while focused; Send orange with text, grey when empty. Below it, Brenda's hero box (variant “hero”) on her home panel, and its small docked size. Suggestions fill the box, never send. Last, the recording look (ElevenLabs'): VoiceCapture and LiveWaveform.">
      <Both>
        {(t) => (
          <div className="space-y-5">
            <p className="type-headline text-center">What do you want to do today?</p>
            <div className="mx-auto max-w-[650px] space-y-4">
              <PromptInputBox value={text[t]} onValueChange={(v) => setTextFor((m) => ({ ...m, [t]: v }))} onSend={() => { setTextFor((m) => ({ ...m, [t]: "" })); setRecFor((m) => ({ ...m, [t]: false })); }} placeholder="Tell Brenda what you need…" label={`Message Brenda (${t})`}
                leading={<PromptAction aria-label="Add"><Plus aria-hidden /></PromptAction>} trailing={<Badge size="sm">Claude</Badge>}
                recording={recFor[t]} onToggleRecording={() => setRecFor((m) => ({ ...m, [t]: !m[t] }))} onCancelRecording={() => setRecFor((m) => ({ ...m, [t]: false }))}
                recordingView={<VoiceCapture compact phase="listening" level={level} heard="Move the design review to Thursday" onCancel={() => setRecFor((m) => ({ ...m, [t]: false }))} />} />
              <PromptInputBox value="Plan my day around the 2pm review" onValueChange={() => {}} onSend={() => {}} isLoading label={`Loading example (${t})`} />
              <PromptInputBox value="" onValueChange={() => {}} onSend={() => {}} transcribing recordingHint="Writing out what you said, on this computer." label={`Transcribing example (${t})`} onToggleRecording={() => {}} />
            </div>
            <ToolTileRow>
              <ToolTile icon={<ListTodo />} label="Plan my day" onClick={() => setTextFor((m) => ({ ...m, [t]: "Plan my day" }))} />
              <ToolTile icon={<Clock />} label="Clock in" onClick={() => setTextFor((m) => ({ ...m, [t]: "Clock me in" }))} />
              <ToolTile icon={<SquareCheckBig />} label="New task" onClick={() => setTextFor((m) => ({ ...m, [t]: "Create a task: " }))} />
            </ToolTileRow>
          </div>
        )}
      </Both>
      <Both>
        {(t) => (
          // Brenda's home (owner decision, 7 October 2026): her panel's orange glow (the one approved gradient) behind
          // the chips and the hero box; the small size is the same box docked under her chat.
          <div className="brenda-panel space-y-3 p-4">
            <Cap>Hero: Brenda&apos;s home box. r16, an orange-tinted hairline with a faint glow inside, translucent over her panel; her glyph; room for a few lines; “More asks” left, microphone and Send right.</Cap>
            <div role="group" aria-label={`Quick asks (${t})`} className="flex flex-wrap gap-2">
              {HERO_CHIPS.map((c) => (
                <Button key={c.label} variant="secondary" size="sm" className="rounded-full bg-[color:var(--brenda-fill)] px-3 [&_svg]:size-3.5 [&_svg]:text-secondary" onClick={() => setHeroFor((m) => ({ ...m, [t]: c.prompt }))}>
                  {c.label}<c.icon aria-hidden />
                </Button>
              ))}
            </div>
            <PromptInputBox variant="hero" value={hero[t]} onValueChange={(v) => setHeroFor((m) => ({ ...m, [t]: v }))} onSend={() => { setHeroFor((m) => ({ ...m, [t]: "" })); setHeroRec((m) => ({ ...m, [t]: false })); }}
              placeholder="Ask Brenda anything…" label={`Hero box (${t})`} leading={<PromptTextAction><Plus aria-hidden />More asks</PromptTextAction>}
              recording={heroRec[t]} onToggleRecording={() => setHeroRec((m) => ({ ...m, [t]: !m[t] }))} onCancelRecording={() => setHeroRec((m) => ({ ...m, [t]: false }))} recordingHint="Speak naturally. Press stop or send when you're done." />
            <Cap className="pt-2">Small: docked under her chat. Solid (--surface), one line to start, 32px actions.</Cap>
            <PromptInputBox variant="hero" size="sm" value={small[t]} onValueChange={(v) => setSmallFor((m) => ({ ...m, [t]: v }))} onSend={() => setSmallFor((m) => ({ ...m, [t]: "" }))}
              placeholder="Reply to Brenda, Ada…" label={`Small hero box (${t})`} leading={<PromptTextAction><Plus aria-hidden />More asks</PromptTextAction>} onToggleRecording={() => {}} />
            <PromptInputBox variant="hero" size="sm" value="Plan my day around the 2pm review" onValueChange={() => {}} onSend={() => {}} isLoading label={`Small hero box, working (${t})`} onToggleRecording={() => {}} />
          </div>
        )}
      </Both>
      <Both>{(t) => <Recording t={t} />}</Both>
    </Section>
  );
}

/**
 * The recording look (owner decision, 7 October 2026: ElevenLabs'): the voice card listening and working, and the bare
 * live waveform's three states. A sample voice level feeds them, so the gallery never opens a microphone.
 */
function Recording({ t }: { t: Theme }) {
  const [speaking, setSpeaking] = React.useState(true);
  const [level, setLevel] = React.useState(0);
  React.useEffect(() => {
    if (!speaking) return;
    const id = window.setInterval(() => {
      const s = Date.now() / 1000;
      setLevel(Math.max(0, Math.min(1, 0.25 + Math.sin(s * 2.1) * 0.35 + Math.sin(s * 5.3) * 0.2)));
    }, 70);
    return () => window.clearInterval(id);
  }, [speaking]);
  const heard = speaking ? level : 0;
  return (
    <div className="space-y-3">
      <Cap>Recording: the live dot and the time in orange, the live waveform (thin bars scrolling in from the right with the voice, edges fading), Cancel and Stop; working, the time stops and the bars become a travelling wave. Reduced motion: still bars.</Cap>
      <Button size="sm" variant="secondary" aria-pressed={speaking} onClick={() => setSpeaking((v) => !v)}>{speaking ? "Pause the sample voice" : "Play a sample voice"}</Button>
      <VoiceCapture phase="listening" level={heard} onStop={() => {}} onCancel={() => {}} className="max-w-[650px]" />
      <VoiceCapture phase="working" seconds={7} heard="Move the design review to Thursday" hint="Writing out what you said, on this computer." className="max-w-[650px]" />
      <VoiceCapture compact phase="listening" level={heard} heard="Move the design review to Thursday" onStop={() => {}} onCancel={() => {}} className="max-w-[420px]" />
      <div className="grid gap-3 sm:grid-cols-3">
        {([["Listening", { active: true, level: heard }], ["Working", { processing: true }], ["Off", {}]] as const).map(([name, props]) => (
          <figure key={name} className="rounded-xl border border-border p-3">
            <LiveWaveform {...props} aria-label={`${name} waveform (${t})`} className="h-9" />
            <figcaption className="mt-2 text-xs font-medium text-secondary">{name}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function Charts() {
  return (
    <Section id="charts" title="Charts" description="The highlight series orange (the selected metric, today, the current period), the rest grey; a sparkline's latest point orange; hairline grids; status colours only for status splits.">
      <Both>
        {() => (
          <div className="grid gap-6 sm:grid-cols-2">
            <AreaChart title="Hours by day" labels={DAYS} series={[{ label: "This week", values: [52, 61, 58, 66, 49, 14, 12] }, { label: "Last week", values: [48, 55, 60, 52, 47, 9, 4] }]} />
            <BarChart title="Revenue by month" labels={["May", "Jun", "Jul", "Aug", "Sep", "Oct"]} values={[1200, 1850, 1600, 2400, 2100, 2650]} format={(n) => `£${Math.round(n / 100) / 10}k`} />
            <Donut title="Plans" items={[{ label: "Free", value: 42, tone: "neutral" }, { label: "Trial", value: 12, tone: "warning" }, { label: "Paid", value: 30, tone: "accent" }]} centre={{ value: 84, label: "live" }} />
            <div className="space-y-6">
              <SegmentBar title="Payments" items={[{ label: "Paid", value: 46, tone: "success" }, { label: "Pending", value: 6, tone: "neutral" }, { label: "Failed", value: 2, tone: "danger" }]} />
              <div className="flex items-center gap-3"><Sparkline label="Trend" values={[3, 5, 4, 8, 6, 9, 11]} /><Sparkline label="Accent trend" tone="accent" values={[9, 7, 8, 5, 6, 4, 3]} /></div>
            </div>
          </div>
        )}
      </Both>
    </Section>
  );
}

// ---- Page -------------------------------------------------------------------------------------------------------------

export function DesignGallery() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Toaster position="bottom-left" offset={24} gap={12} toastOptions={{ unstyled: true, classNames: { toast: "w-auto" } }} />
      <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-[var(--header-bg)] backdrop-blur-[8px]">
        <div className="flex h-[50px] items-center gap-3 px-5">
          <Logo href="/dev/design" height={16} />
          <span className="text-sm font-medium text-secondary">Design system v4</span>
          <span className="ml-auto flex items-center gap-1"><ThemeToggle /></span>
        </div>
        <nav aria-label="Sections" className="flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="inline-flex h-7 shrink-0 items-center rounded-lg px-2 text-meta font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground">{label}</a>)}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-[1600px] space-y-14 px-5 pb-24 pt-8">
        <PageHeader title="Design system v4" description="The ElevenLabs app's design language with Boredroom orange (owner decision, 6 October 2026). Every part in src/components/ui, in each state, dark and light. Rules: docs/design-system.md." divider
          actions={<><Button variant="secondary" size="sm" onClick={() => document.getElementById("frame")?.scrollIntoView()}>App frame</Button><Button size="sm" onClick={() => document.getElementById("buttons")?.scrollIntoView()}>Parts</Button></>} />
        <Foundations />
        <Accents />
        <TypeScale />
        <Buttons />
        <Inputs />
        <Selection />
        <TabsDemo />
        <Badges />
        <Cards />
        <Stats />
        <Analytics />
        <Filters />
        <Tiles />
        <Lists />
        <Tables />
        <Feedback />
        <Overlays />
        <Pickers />
        <Prompt />
        <Charts />
        <Section id="frame" title="App frame" description="The v4 shell at real sizes: 256px sidebar, 50px top bar with centred search, page header with tabs, stat cards, the analytics card and a table. Copy from src/app/dev/design/app-frame.tsx.">
          <SampleAppFrame />
        </Section>
      </main>
    </div>
  );
}
