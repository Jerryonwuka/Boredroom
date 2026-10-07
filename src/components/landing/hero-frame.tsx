import { Activity, ArrowUp, Bell, ChevronRight, ChevronsUpDown, CircleAlert, ClipboardCheck, ClipboardList, FileText, FolderKanban, History, LayoutDashboard, ListChecks, MessageSquare, MessageSquareReply, Mic, PanelLeft, Plus, Search, Users, UsersRound, Video, type LucideIcon } from "lucide-react";
import { LogoArt } from "@/components/logo";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { BrendaFace } from "@/components/app/brenda-face";
import { Avatar } from "@/components/ui/avatar";
import { CountPill, Kbd } from "@/components/ui/badge";
import { ToolTile, ToolTileRow } from "@/components/ui/tool-tile";
import { Stage } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

/**
 * The hero's product view: a team lead's workspace on Brenda's home, drawn with the app's own v4 parts at their real
 * sizes. The sidebar (the organisation menu, Brenda first, her icon orange as the current page, Messages with an
 * orange unread count), the 50px top bar (breadcrumb, search, bell, avatar), her face and the headline, the prompt
 * pill (empty, so Send is grey: the page's one orange button is the call to action above), her five asks as tool
 * tiles, and her three action cards (nothing under them: "Your day" moved to My Day, owner request 7 October 2026).
 * A picture, not a control: `inert` and hidden from assistive technology (the hero copy says the same in words). Below
 * 768px the sidebar folds away as it does in the app.
 */
type NavIcon = LucideIcon | typeof BrendaGlyph;
const NAV: { group?: string; items: { label: string; icon: NavIcon; active?: boolean; count?: number }[] }[] = [
  { items: [{ label: "Brenda", icon: BrendaGlyph, active: true }, { label: "Dashboard", icon: LayoutDashboard }, { label: "Attendance", icon: ClipboardList }, { label: "Workroom", icon: Activity }] },
  { group: "Work", items: [{ label: "Tasks", icon: ListChecks }, { label: "Messages", icon: MessageSquare, count: 3 }, { label: "Docs", icon: FileText }, { label: "Reviews", icon: ClipboardCheck }, { label: "Projects", icon: FolderKanban }] },
  { group: "Organisation", items: [{ label: "People and teams", icon: UsersRound }, { label: "Recordings", icon: Video }, { label: "Timesheets", icon: History }] },
];

/** A team lead's three action cards under her box, as on Brenda's home (components/app/brenda-home, CARDS.lead). */
const CARDS: { icon: LucideIcon; title: string; line: string; action: string }[] = [
  { icon: ClipboardCheck, title: "Week summary", line: "What the team got done this week.", action: "Summarise" },
  { icon: MessageSquareReply, title: "Chase work", line: "Assignments nobody has picked up yet.", action: "Chase it" },
  { icon: FileText, title: "Write a doc", line: "A brief, a policy or notes, drafted with you.", action: "Draft it" },
];

/** A team lead's asks, as on Brenda's home. */
const ASKS: { icon: LucideIcon; label: string }[] = [
  { icon: Users, label: "Who's working" },
  { icon: ClipboardCheck, label: "Week summary" },
  { icon: MessageSquareReply, label: "Chase work" },
  { icon: FileText, label: "Write a doc" },
  { icon: CircleAlert, label: "Who's late" },
];

const ICON_BTN = "grid size-8 shrink-0 place-items-center rounded-[10px] text-secondary [&_svg]:size-4";

function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-[50px] shrink-0 items-center justify-between pl-[18px] pr-3">
        <LogoArt height={16} />
        <span className={ICON_BTN}><PanelLeft /></span>
      </div>
      <div className="flex-1 px-3 pt-1">
        {NAV.map((g, gi) => (
          <div key={gi} className={gi ? "mt-4" : undefined}>
            {g.group ? <p className="mb-1 px-1.5 text-sm font-medium text-secondary">{g.group}</p> : null}
            <ul className="space-y-1">
              {g.items.map(({ label, icon: Icon, active, count }) => (
                <li key={label} className={cn("flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium [&>svg]:size-[18px] [&>svg]:shrink-0", active ? "bg-fill-1 text-foreground [&>svg]:text-accent" : "text-secondary")}>
                  <Icon />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {count ? <CountPill count={count} tone="attention" /> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="p-3">
        <div className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium text-foreground">
          <Avatar profileId="landing-company" name="Company A" size={20} />
          <span className="min-w-0 flex-1 truncate">Company A</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-secondary" />
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  return (
    <div className="grid h-[50px] shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-3 lg:grid-cols-[1fr_auto_1fr]">
      <div className="flex min-w-0 items-center gap-1">
        <span className={cn(ICON_BTN, "md:hidden")}><PanelLeft /></span>
        <span className="flex min-w-0 items-center gap-1 pl-1 text-sm font-medium">
          <span className="truncate text-secondary">Company A</span>
          <ChevronRight className="size-3.5 shrink-0 text-secondary" />
          <span className="truncate text-foreground">Brenda</span>
        </span>
      </div>
      <span className="hidden h-8 w-[230px] items-center gap-2 rounded-xl border border-border-input bg-background px-3 text-meta font-normal text-secondary lg:flex">
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate">Search everything…</span>
        <span className="flex gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
      </span>
      <div className="flex items-center justify-end gap-1.5">
        <span className="hidden h-8 items-center rounded-[10px] border border-border-input px-2.5 text-meta font-medium text-foreground sm:inline-flex">Feedback</span>
        <span className={ICON_BTN}><Bell /></span>
        <Avatar profileId="landing-david" name="David Okafor" size={28} />
      </div>
    </div>
  );
}

/** The prompt pill, empty: r26, fill-1 laid solid, a hairline ring, the "+", the placeholder, the microphone, a grey Send. */
function PromptPill() {
  return (
    <div className="flex w-full items-center gap-1 rounded-[26px] bg-surface p-2 text-left shadow-[0_0_0_1px_var(--border),var(--elev-natural-xs)]">
      <span className="grid size-9 shrink-0 place-items-center rounded-full text-secondary"><Plus className="size-[18px]" /></span>
      <span className="min-w-0 flex-1 truncate py-1.5 pl-1 text-base font-normal text-subtle">Ask about the team…</span>
      <span className="grid size-9 shrink-0 place-items-center rounded-full text-secondary"><Mic className="size-[18px]" /></span>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill-150 text-subtle"><ArrowUp className="size-[18px]" strokeWidth={2.25} /></span>
    </div>
  );
}

export function HeroFrame() {
  return (
    <Stage reveal={false}>
      <div inert aria-hidden className="flex text-left">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="flex flex-col items-center px-4 pb-2 pt-9 text-center sm:px-8 md:pt-12">
            <BrendaFace size="lg" />
            <p className="mt-3 text-sm font-medium text-secondary">Good morning, David.</p>
            <p className="type-headline mt-1">What do you want to do today?</p>
            <div className="mt-5 w-full max-w-[560px]"><PromptPill /></div>
            <ToolTileRow className="mt-9">
              {ASKS.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} tabIndex={-1} />)}
            </ToolTileRow>
          </div>
          {/* Under her box, as on her home: the three action cards (nothing under them: "Your day" lives on My Day). */}
          <div className="@container mx-auto w-full max-w-[720px] px-4 pb-6 pt-8 sm:px-8">
            <ul className="grid gap-3 @xl:grid-cols-3">
              {CARDS.map((c) => (
                <li key={c.title} className="flex min-w-0 flex-col rounded-2xl border border-border bg-fill-0 p-4">
                  <span className="flex items-start justify-between gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-secondary [&_svg]:size-4"><c.icon /></span>
                    <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-fill-1 px-2.5 text-xs font-medium text-foreground">{c.action}</span>
                  </span>
                  <span className="mt-3 text-sm font-semibold text-foreground">{c.title}</span>
                  <span className="mt-0.5 text-meta font-normal text-secondary">{c.line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Stage>
  );
}
