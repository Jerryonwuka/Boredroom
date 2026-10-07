"use client";

/**
 * My Day: your day at a glance. The running timer (only while something is on the clock), then "Your day" (owner
 * request, 7 October 2026: moved here from under Brenda's home panel; components/app/your-day), passed in by the page
 * as `yourDay`: the day's figures, your clock as a row that opens the Clock in page, and what is due, overdue or
 * waiting; team leads also get a Team tab. Beside it, "How it works".
 *
 * The to-do list has its own page (owner request, 7 October 2026: "Take the to-do list that's currently in My Day and
 * create a new separate tab/page for To-do"; components/app/todo-list). Both pages carry the same timer
 * (`useWorkClock`), so a to-do started on To-dos shows here, and Pause, Switch task and Stop work from either.
 *
 * No clock-in card and no idle clock here (owner decision, 5 October 2026): clocking in has its own page.
 *
 * "How it works" names the person's own assistant (owner decision, 7 October 2026: personal assistants; `useAssistant`).
 */
import { useMemo } from "react";
import Link from "next/link";
import { CaptureProvider, useCaptureSupported } from "@/components/app/capture";
import { startableTasks, todoRows, useWorkClock } from "@/components/app/todo-list";
import type { CurrentSessionPayload } from "@/components/app/session-timer";
import { Card, CardHeader } from "@/components/ui/card";
import { useAssistant } from "@/components/app/assistant-context";
import type { TaskRow } from "@/server/services/views";

type Props = {
  orgSlug: string; initialSession: CurrentSessionPayload;
  /** The to-dos the timer may start or switch to (the same list as on To-dos). */
  planned: TaskRow[]; ownTodos: TaskRow[]; fromLeads: TaskRow[];
  recordingMode: string;
  /** Team leads hand to-dos out with "For"; "How it works" says so. */
  lead: boolean;
  /** "Your day" (and Team for leads), rendered by the page on the server's data; shown under the timer. */
  yourDay?: React.ReactNode;
};

export function MyDayBoard(props: Props) {
  return (
    <CaptureProvider orgSlug={props.orgSlug} recordingMode={props.recordingMode} rules={props.initialSession.recording}>
      <Board {...props} />
    </CaptureProvider>
  );
}

function Board({ orgSlug, initialSession, planned, ownTodos, fromLeads, recordingMode, lead, yourDay }: Props) {
  const captureSupported = useCaptureSupported();
  const { name } = useAssistant().personal;
  const startable = useMemo(() => startableTasks(todoRows(planned, fromLeads, ownTodos)), [planned, fromLeads, ownTodos]);
  const clock = useWorkClock({ orgSlug, initialSession, tasks: startable, recordingMode });
  const canRecord = recordingMode !== "disabled" && captureSupported === true;
  const todos = `/app/${orgSlug}/todos`;

  return (
    <div className="grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        {clock.timer}
        {yourDay}
      </div>

      <aside aria-labelledby="how-heading">
        <Card>
          <CardHeader as="h2" size="sm" title={<span id="how-heading">How it works</span>} className="mb-3" />
          <ol className="list-decimal space-y-2 pl-4 text-sm font-normal text-secondary marker:text-subtle">
            <li>On <Link href={todos} className="link-inline">To-dos</Link>, press <strong className="font-medium text-foreground">+</strong> and write your to-dos for today, or dictate them and {name} writes them down. Your team lead may add some too.</li>
            <li>Press <strong className="font-medium text-foreground">Start</strong> on the one you are working on{canRecord ? ", with or without screen recording" : ""}. Its timer shows here and on To-dos while it runs.</li>
            <li>Press <strong className="font-medium text-foreground">Mark done</strong> when you finish. It goes to your lead for a quick check, then shows as Completed.</li>
            {lead ? <li>As a team lead, use “For” on a new to-do to hand it to someone on your team, or to anyone else in the organisation, or say who it is for when you dictate.</li> : null}
          </ol>
          {/* "There is no daily report to write" is one of the page's notes at the bottom (my-day/page.tsx). */}
        </Card>
      </aside>
    </div>
  );
}
