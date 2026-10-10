import type { CSSProperties } from "react";
import { Activity, ArrowUp, Bell, ChevronRight, ChevronsUpDown, CircleAlert, ClipboardCheck, ClipboardList, FileText, FolderKanban, Handshake, History, Inbox, LayoutDashboard, ListChecks, MessageSquare, MessageSquareReply, Mic, PanelLeft, Plus, Search, UserPlus, Users, UsersRound, Video, type LucideIcon } from "lucide-react";
import { LogoArt } from "@/components/logo";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { BrendaFace } from "@/components/app/brenda-face";
import { Avatar } from "@/components/ui/avatar";
import { CountPill, Kbd } from "@/components/ui/badge";
import { Stage } from "@/components/landing/parts";
import { PALETTE, type AssistantLook } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/**
 * The landing page's product frame, drawn with the app's own v4 parts at their real sizes (owner request, 10 October
 * 2026: the page brought up to today's product). `AppFrame` is an owner's workspace as `components/app/shell.tsx`
 * builds it: the sidebar (Brenda first, then Dashboard, Attendance, Workroom; Work with Commitments, Messages and its
 * orange unread count, Calls, Docs, Reviews, Projects; Organisation), the 50px top bar (breadcrumb, search, Feedback,
 * bell, avatar), and the page inside. The current page's icon is orange (the accent rules). Below 768px the sidebar
 * folds away as it does in the app.
 *
 * `BrendaHomeFrame` is her home as it is now, for "Brenda works for each person": her panel's glow in purple (the
 * person picks her colour), her face floating with no orb, the greeting and the headline, then the quick-ask chips, her
 * box and a lead's three cards. A picture of the approved home-panel exception, not a new use of it.
 *
 * Both are pictures, not controls: `inert` and hidden from assistive technology (the section copy says the same in
 * words; the scroll card's viewport carries the description).
 */
type NavIcon = LucideIcon | typeof BrendaGlyph;
type NavKey = "brenda" | "dashboard";
const NAV: { group?: string; items: { label: string; icon: NavIcon; key?: NavKey; count?: number }[] }[] = [
  { items: [{ label: "Brenda", icon: BrendaGlyph, key: "brenda" }, { label: "Dashboard", icon: LayoutDashboard, key: "dashboard" }, { label: "Attendance", icon: ClipboardList }, { label: "Workroom", icon: Activity }] },
  { group: "Work", items: [{ label: "Tasks", icon: ListChecks }, { label: "Commitments", icon: Handshake }, { label: "Messages", icon: MessageSquare, count: 3 }, { label: "Calls", icon: Video }, { label: "Docs", icon: FileText }, { label: "Reviews", icon: ClipboardCheck }, { label: "Projects", icon: FolderKanban }] },
  { group: "Organisation", items: [{ label: "People and teams", icon: UsersRound }, { label: "Timesheets", icon: History }] },
];

const ICON_BTN = "grid size-8 shrink-0 place-items-center rounded-[10px] text-secondary [&_svg]:size-4";

function Sidebar({ active }: { active: NavKey }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-[50px] shrink-0 items-center justify-between pl-[18px] pr-3">
        <LogoArt height={16} />
        <span className={ICON_BTN}><PanelLeft /></span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pt-1">
        {NAV.map((g, gi) => (
          <div key={gi} className={gi ? "mt-4" : undefined}>
            {g.group ? <p className="mb-1 px-1.5 text-sm font-medium text-secondary">{g.group}</p> : null}
            <ul className="space-y-1">
              {g.items.map(({ label, icon: Icon, key, count }) => (
                <li key={label} className={cn("flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium [&>svg]:size-[18px] [&>svg]:shrink-0", key === active ? "bg-fill-1 text-foreground [&>svg]:text-accent" : "text-secondary")}>
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

function TopBar({ crumb }: { crumb: string }) {
  return (
    <div className="grid h-[50px] shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-3 lg:grid-cols-[1fr_auto_1fr]">
      <div className="flex min-w-0 items-center gap-1">
        <span className={cn(ICON_BTN, "md:hidden")}><PanelLeft /></span>
        <span className="flex min-w-0 items-center gap-1 pl-1 text-sm font-medium">
          <span className="truncate text-secondary">Company A</span>
          <ChevronRight className="size-3.5 shrink-0 text-secondary" />
          <span className="truncate text-foreground">{crumb}</span>
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

/** An owner's workspace around `children`: the sidebar with `active` as the current page, the top bar ending in `crumb`. */
export function AppFrame({ active, crumb, children, className }: { active: NavKey; crumb: string; children: React.ReactNode; className?: string }) {
  return (
    <div inert aria-hidden className={cn("flex h-full text-left", className)}>
      <Sidebar active={active} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar crumb={crumb} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** Purple, so the section can say she takes the colour each person picks (her home's own glow, `panelTint`). */
const LOOK: AssistantLook = { colour: "purple", visor: "bean", eyes: "pill" };
const TINT = { "--brenda-tint-dark": PALETTE.purple.sphere.shade, "--brenda-tint-light": PALETTE.purple.sphere.rim } as CSSProperties;

/** A lead's quick asks, as chips above her box (brenda-home QUICK.lead): the label, then a small icon. */
const QUICK: { icon: LucideIcon; label: string }[] = [
  { icon: Inbox, label: "What did I miss?" },
  { icon: Users, label: "Who's working?" },
  { icon: CircleAlert, label: "Who's late?" },
  { icon: UserPlus, label: "Assign a task" },
];

/** A lead's three cards under her box (brenda-home CARDS.lead). */
const CARDS: { icon: LucideIcon; title: string; line: string; action: string }[] = [
  { icon: ClipboardCheck, title: "Week summary", line: "What the team got done this week.", action: "Summarise" },
  { icon: MessageSquareReply, title: "Chase work", line: "Assignments nobody has picked up yet.", action: "Chase it" },
  { icon: FileText, title: "Write a doc", line: "A brief, a policy or notes, drafted with you.", action: "Draft it" },
];

/** Her box, empty (PromptInputBox variant="hero"): her glyph in orange, the placeholder, "More asks", the microphone and a grey Send. */
function HeroBox() {
  return (
    <div className="prompt-hero">
      <div className="flex items-start gap-3 px-4 pt-4">
        <BrendaGlyph aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
        <span className="min-h-12 flex-1 text-base font-normal text-subtle sm:min-h-[72px]">Ask Brenda anything…</span>
      </div>
      <div className="flex items-center gap-1 px-3 pb-3 pt-2">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-meta font-medium text-secondary [&_svg]:size-4"><Plus />More asks</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="grid size-9 place-items-center rounded-full bg-fill-1 text-secondary"><Mic className="size-[18px]" /></span>
          <span className="grid size-9 place-items-center rounded-full bg-fill-150 text-subtle"><ArrowUp className="size-[18px]" strokeWidth={2.25} /></span>
        </span>
      </div>
    </div>
  );
}

/** Brenda's home in a team lead's workspace, on a Stage (it sits below the fold, so it fades in as it arrives). */
export function BrendaHomeFrame() {
  return (
    <Stage>
      <AppFrame active="brenda" crumb="Brenda">
        <div className="p-3 sm:p-4">
          <div style={TINT} className="brenda-panel flex flex-col p-3 sm:p-4 lg:p-5">
            <div className="flex flex-col items-center px-1 pb-8 pt-10 text-center sm:pb-10 sm:pt-14">
              <BrendaFace size="lg" look={LOOK} quiet />
              <p className="mt-5 text-sm font-medium text-secondary">Good afternoon, David.</p>
              <p className="type-headline mt-1 sm:text-[32px] sm:leading-10">What do you want to do today?</p>
            </div>
            <div className="@container mx-auto w-full max-w-[720px]">
              <div className="mb-3 flex flex-wrap gap-2">
                {QUICK.map((a) => (
                  <span key={a.label} className="brenda-glass-pill inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-[color:var(--brenda-fill)] px-3 text-meta font-medium text-foreground [&_svg]:size-3.5 [&_svg]:text-secondary">
                    {a.label}<a.icon />
                  </span>
                ))}
              </div>
              <HeroBox />
              <ul className="mt-3 grid gap-3 @xl:grid-cols-3">
                {CARDS.map((c) => (
                  <li key={c.title} className="flex min-w-0 flex-col rounded-2xl border border-border bg-[color:var(--brenda-fill)] p-4">
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
      </AppFrame>
    </Stage>
  );
}
