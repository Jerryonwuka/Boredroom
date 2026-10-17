/**
 * Every product picture for the public pages in one import (owner feedback, 17 October 2026: pages v2: "real product
 * visuals built in code"). Re-exports only: each mock stays with its owner, who keeps its name and props stable. All are
 * pictures (role="img" with a description); MessagesDemo is the one interactive demo (never put it inside a role="img").
 *
 *   import { FollowUpMock, EndOfDayReportMock, BrendaHomePanel } from "@/components/marketing/visuals";
 */
export { MyDayMock, AttendanceMock, ReportsMock } from "@/components/landing/mocks";
export { CallCard, ChangesCard } from "@/components/landing/panels";
export { FollowUpMock, CommitmentMock, RecapMock, NotchMock } from "@/components/landing/assistant-mocks";
export { MessagesDemo } from "@/components/landing/messages-demo";
export { EndOfDayReportMock, StandupCardMock } from "@/components/marketing/blog/product-mocks";
export { TimesheetCorrectionMock } from "@/components/marketing/product/timesheet-mock";
export { BrendaHomePanel } from "./brenda-home-panel";
export { DashboardPeek } from "./dashboard-peek";
export { AssistantsRow } from "./assistants-row";
export { HeroCluster, VisualStage } from "@/components/marketing/hero-visual";
export { LiveClock } from "@/components/marketing/live-clock";
