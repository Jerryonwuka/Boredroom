/**
 * Animated icons (owner request, 7 October 2026: "For our icons, I want our icons to be animated icons"). The icons
 * themselves are client components (./adapter has how they play); this module is not, so a Server Component can use
 * it too: `withAnimatedIcons` and `animatedTwin` swap a lucide icon for its animated twin, and the primitives that hold
 * an icon (Button, IconButton, MenuItem, Tabs, ToolTile, QuickLink, SubNavItem, StatCard, EmptyState, the prompt box's
 * actions) call them, so a lucide icon given to them animates without its caller changing anything. Elsewhere, import
 * the twin (`AnimatedBell`) in place of the lucide icon; it takes the same props.
 *
 * Every twin is listed in `TWINS`, with the lucide icon it stands in for: add a new one there (and to /dev/design's
 * "Animated icons"). An icon with no twin stays lucide's, still.
 */
import * as React from "react";
import {
  Activity, AlarmClock, Archive, ArrowLeft, ArrowUp, ArrowUpRight, Bell, Building2, CalendarCheck, CalendarDays, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronsUpDown, CircleAlert, CircleCheck, ClipboardCheck, ClipboardList, Clock, Copy, Download, Eye, EyeOff, FileText, FolderKanban,
  History, Hourglass, Inbox, Kanban, LayoutDashboard, LayoutGrid, ListChecks, ListOrdered, ListPlus, ListTodo, Lock, LogOut, MessageSquare,
  MessageSquareReply, MessagesSquare, Mic, Moon, PanelLeft, Pause, Play, Plus, RefreshCw, RotateCcw, Search, Send, Settings, ShieldCheck, Sun,
  Timer, Upload, User, UserPlus, Users, UsersRound, Video, X,
} from "lucide-react";
import type { AnimatedIcon } from "./adapter";
import { AnimatedActivity } from "./activity";
import { AnimatedAlarmClock } from "./alarm-clock";
import { AnimatedArchive } from "./archive";
import { AnimatedArrowLeft } from "./arrow-left";
import { AnimatedArrowUp } from "./arrow-up";
import { AnimatedArrowUpRight } from "./arrow-up-right";
import { AnimatedBell } from "./bell";
import { AnimatedBuilding2 } from "./building-2";
import { AnimatedCalendarCheck } from "./calendar-check";
import { AnimatedCalendarDays } from "./calendar-days";
import { AnimatedCheck } from "./check";
import { AnimatedChevronDown } from "./chevron-down";
import { AnimatedChevronLeft } from "./chevron-left";
import { AnimatedChevronRight } from "./chevron-right";
import { AnimatedChevronsUpDown } from "./chevrons-up-down";
import { AnimatedCircleAlert } from "./circle-alert";
import { AnimatedCircleCheck } from "./circle-check";
import { AnimatedClipboardCheck } from "./clipboard-check";
import { AnimatedClipboardList } from "./clipboard-list";
import { AnimatedClock } from "./clock";
import { AnimatedCopy } from "./copy";
import { AnimatedDownload } from "./download";
import { AnimatedEye } from "./eye";
import { AnimatedEyeOff } from "./eye-off";
import { AnimatedFileText } from "./file-text";
import { AnimatedFolderKanban } from "./folder-kanban";
import { AnimatedHistory } from "./history";
import { AnimatedHourglass } from "./hourglass";
import { AnimatedInbox } from "./inbox";
import { AnimatedKanban } from "./kanban";
import { AnimatedLayoutDashboard } from "./layout-dashboard";
import { AnimatedLayoutGrid } from "./layout-grid";
import { AnimatedListChecks } from "./list-checks";
import { AnimatedListOrdered } from "./list-ordered";
import { AnimatedListPlus } from "./list-plus";
import { AnimatedListTodo } from "./list-todo";
import { AnimatedLock } from "./lock";
import { AnimatedLogOut } from "./log-out";
import { AnimatedMessageSquare } from "./message-square";
import { AnimatedMessageSquareReply } from "./message-square-reply";
import { AnimatedMessagesSquare } from "./messages-square";
import { AnimatedMic } from "./mic";
import { AnimatedMoon } from "./moon";
import { AnimatedPanelLeft } from "./panel-left";
import { AnimatedPause } from "./pause";
import { AnimatedPlay } from "./play";
import { AnimatedPlus } from "./plus";
import { AnimatedRefreshCw } from "./refresh-cw";
import { AnimatedRotateCcw } from "./rotate-ccw";
import { AnimatedSearch } from "./search";
import { AnimatedSend } from "./send";
import { AnimatedSettings } from "./settings";
import { AnimatedShieldCheck } from "./shield-check";
import { AnimatedSun } from "./sun";
import { AnimatedTimer } from "./timer";
import { AnimatedUpload } from "./upload";
import { AnimatedUser } from "./user";
import { AnimatedUserPlus } from "./user-plus";
import { AnimatedUsers } from "./users";
import { AnimatedUsersRound } from "./users-round";
import { AnimatedVideo } from "./video";
import { AnimatedX } from "./x";

export type { AnimatedIcon, AnimatedIconProps } from "./adapter";
export {
  AnimatedActivity, AnimatedAlarmClock, AnimatedArchive, AnimatedArrowLeft, AnimatedArrowUp, AnimatedArrowUpRight, AnimatedBell, AnimatedBuilding2,
  AnimatedCalendarCheck, AnimatedCalendarDays, AnimatedCheck, AnimatedChevronDown, AnimatedChevronLeft, AnimatedChevronRight, AnimatedChevronsUpDown,
  AnimatedCircleAlert, AnimatedCircleCheck, AnimatedClipboardCheck, AnimatedClipboardList, AnimatedClock, AnimatedCopy, AnimatedDownload, AnimatedEye,
  AnimatedEyeOff, AnimatedFileText, AnimatedFolderKanban, AnimatedHistory, AnimatedHourglass, AnimatedInbox, AnimatedKanban, AnimatedLayoutDashboard,
  AnimatedLayoutGrid, AnimatedListChecks, AnimatedListOrdered, AnimatedListPlus, AnimatedListTodo, AnimatedLock, AnimatedLogOut, AnimatedMessageSquare,
  AnimatedMessageSquareReply, AnimatedMessagesSquare, AnimatedMic, AnimatedMoon, AnimatedPanelLeft, AnimatedPause, AnimatedPlay, AnimatedPlus,
  AnimatedRefreshCw, AnimatedRotateCcw, AnimatedSearch, AnimatedSend, AnimatedSettings, AnimatedShieldCheck, AnimatedSun, AnimatedTimer, AnimatedUpload,
  AnimatedUser, AnimatedUserPlus, AnimatedUsers, AnimatedUsersRound, AnimatedVideo, AnimatedX,
};

/** Each lucide icon with its animated twin, in lucide's name order. `ANIMATED_ICONS` lists them for the gallery. */
export const ANIMATED_ICONS: readonly { name: string; lucide: unknown; twin: AnimatedIcon; own?: true }[] = [
  { name: "Activity", lucide: Activity, twin: AnimatedActivity },
  { name: "AlarmClock", lucide: AlarmClock, twin: AnimatedAlarmClock },
  { name: "Archive", lucide: Archive, twin: AnimatedArchive },
  { name: "ArrowLeft", lucide: ArrowLeft, twin: AnimatedArrowLeft },
  { name: "ArrowUp", lucide: ArrowUp, twin: AnimatedArrowUp },
  { name: "ArrowUpRight", lucide: ArrowUpRight, twin: AnimatedArrowUpRight },
  { name: "Bell", lucide: Bell, twin: AnimatedBell },
  { name: "Building2", lucide: Building2, twin: AnimatedBuilding2, own: true },
  { name: "CalendarCheck", lucide: CalendarCheck, twin: AnimatedCalendarCheck },
  { name: "CalendarDays", lucide: CalendarDays, twin: AnimatedCalendarDays },
  { name: "Check", lucide: Check, twin: AnimatedCheck },
  { name: "ChevronDown", lucide: ChevronDown, twin: AnimatedChevronDown },
  { name: "ChevronLeft", lucide: ChevronLeft, twin: AnimatedChevronLeft },
  { name: "ChevronRight", lucide: ChevronRight, twin: AnimatedChevronRight },
  { name: "ChevronsUpDown", lucide: ChevronsUpDown, twin: AnimatedChevronsUpDown },
  { name: "CircleAlert", lucide: CircleAlert, twin: AnimatedCircleAlert, own: true },
  { name: "CircleCheck", lucide: CircleCheck, twin: AnimatedCircleCheck },
  { name: "ClipboardCheck", lucide: ClipboardCheck, twin: AnimatedClipboardCheck },
  { name: "ClipboardList", lucide: ClipboardList, twin: AnimatedClipboardList, own: true },
  { name: "Clock", lucide: Clock, twin: AnimatedClock },
  { name: "Copy", lucide: Copy, twin: AnimatedCopy },
  { name: "Download", lucide: Download, twin: AnimatedDownload },
  { name: "Eye", lucide: Eye, twin: AnimatedEye },
  { name: "EyeOff", lucide: EyeOff, twin: AnimatedEyeOff },
  { name: "FileText", lucide: FileText, twin: AnimatedFileText },
  { name: "FolderKanban", lucide: FolderKanban, twin: AnimatedFolderKanban },
  { name: "History", lucide: History, twin: AnimatedHistory },
  { name: "Hourglass", lucide: Hourglass, twin: AnimatedHourglass },
  { name: "Inbox", lucide: Inbox, twin: AnimatedInbox, own: true },
  { name: "Kanban", lucide: Kanban, twin: AnimatedKanban, own: true },
  { name: "LayoutDashboard", lucide: LayoutDashboard, twin: AnimatedLayoutDashboard, own: true },
  { name: "LayoutGrid", lucide: LayoutGrid, twin: AnimatedLayoutGrid },
  { name: "ListChecks", lucide: ListChecks, twin: AnimatedListChecks, own: true },
  { name: "ListOrdered", lucide: ListOrdered, twin: AnimatedListOrdered, own: true },
  { name: "ListPlus", lucide: ListPlus, twin: AnimatedListPlus, own: true },
  { name: "ListTodo", lucide: ListTodo, twin: AnimatedListTodo, own: true },
  { name: "Lock", lucide: Lock, twin: AnimatedLock },
  { name: "LogOut", lucide: LogOut, twin: AnimatedLogOut },
  { name: "MessageSquare", lucide: MessageSquare, twin: AnimatedMessageSquare },
  { name: "MessageSquareReply", lucide: MessageSquareReply, twin: AnimatedMessageSquareReply, own: true },
  { name: "MessagesSquare", lucide: MessagesSquare, twin: AnimatedMessagesSquare, own: true },
  { name: "Mic", lucide: Mic, twin: AnimatedMic },
  { name: "Moon", lucide: Moon, twin: AnimatedMoon },
  { name: "PanelLeft", lucide: PanelLeft, twin: AnimatedPanelLeft, own: true },
  { name: "Pause", lucide: Pause, twin: AnimatedPause },
  { name: "Play", lucide: Play, twin: AnimatedPlay },
  { name: "Plus", lucide: Plus, twin: AnimatedPlus },
  { name: "RefreshCw", lucide: RefreshCw, twin: AnimatedRefreshCw },
  { name: "RotateCcw", lucide: RotateCcw, twin: AnimatedRotateCcw },
  { name: "Search", lucide: Search, twin: AnimatedSearch },
  { name: "Send", lucide: Send, twin: AnimatedSend },
  { name: "Settings", lucide: Settings, twin: AnimatedSettings },
  { name: "ShieldCheck", lucide: ShieldCheck, twin: AnimatedShieldCheck },
  { name: "Sun", lucide: Sun, twin: AnimatedSun },
  { name: "Timer", lucide: Timer, twin: AnimatedTimer },
  { name: "Upload", lucide: Upload, twin: AnimatedUpload },
  { name: "User", lucide: User, twin: AnimatedUser },
  { name: "UserPlus", lucide: UserPlus, twin: AnimatedUserPlus },
  { name: "Users", lucide: Users, twin: AnimatedUsers },
  { name: "UsersRound", lucide: UsersRound, twin: AnimatedUsersRound },
  { name: "Video", lucide: Video, twin: AnimatedVideo, own: true },
  { name: "X", lucide: X, twin: AnimatedX },
];

const TWINS = new Map<unknown, AnimatedIcon>(ANIMATED_ICONS.map((i) => [i.lucide, i.twin]));

/** The animated twin of a lucide icon component, or the component itself when it has none (or is already animated). */
export function animatedTwin<T>(icon: T): T | AnimatedIcon {
  return TWINS.get(icon) ?? icon;
}

const hasTwin = (node: React.ReactNode) => {
  let found = false;
  React.Children.forEach(node, (child) => { if (React.isValidElement(child) && TWINS.has(child.type)) found = true; });
  return found;
};

/**
 * Swaps each lucide icon element at the top level of `node` (`<Plus aria-hidden />` among a button's children) for
 * its animated twin, with the same props. Anything else, and a node with nothing to swap, comes back untouched.
 */
export function withAnimatedIcons(node: React.ReactNode): React.ReactNode {
  if (!hasTwin(node)) return node;
  return React.Children.map(node, (child) => {
    if (!React.isValidElement(child)) return child;
    const twin = TWINS.get(child.type);
    return twin ? React.createElement(twin, child.props as React.ComponentProps<AnimatedIcon>) : child;
  });
}
