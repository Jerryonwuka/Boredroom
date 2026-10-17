import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  RING_PAD, faceSpot, findShownTarget, isShownTarget, labelFor, pillSpot, pillWidth, pointOfHref, pointerPlan, ringFor, startSpot, targetSelector,
  type Box, type TargetLike,
} from "@/components/app/brenda-pointer";
import { BRENDA_TARGETS, TARGET_ATTR } from "@/lib/brenda-targets";

// Brenda points inside Boredroom (owner request, 11 October 2026: "press the two buttons, ask Brenda a question about what
// I'm pointing at on my screen and she helps me out with it"; contract E.2). The pointer's pure helpers: finding a shown
// target, the reduced-motion plan, the label, and where the face, ring and pill go.

/** A stand-in element: a box, and whether it (or an ancestor) is hidden, inert or aria-hidden. */
const el = (width: number, height: number, hiddenAncestor = false): TargetLike & { id: string } => ({
  id: `${width}x${height}${hiddenAncestor ? "-hidden" : ""}`,
  getBoundingClientRect: () => ({ width, height }),
  closest: (sel: string) => (hiddenAncestor && sel.includes("[hidden]") && sel.includes("[inert]") && sel.includes("aria-hidden") ? {} : null),
});
const rootOf = (map: Record<string, ReturnType<typeof el>[]>) => ({
  querySelectorAll: (sel: string) => map[sel] ?? [],
});
const VP = { width: 1280, height: 800 };

describe("the plan", () => {
  it("glides, draws, holds 3 s and fades with motion", () => {
    expect(pointerPlan(false)).toEqual({ glide: 600, draw: 450, hold: 3000, fade: 400, wait: 4000 });
  });
  it("shows everything at once for 4 s under reduced motion", () => {
    const p = pointerPlan(true);
    expect(p.glide).toBe(0);
    expect(p.draw).toBe(0);
    expect(p.fade).toBe(0);
    expect(p.hold).toBe(4000);
    expect(p.wait).toBe(4000);
  });
});

describe("finding a shown target", () => {
  it("builds the selector from known-safe keys only", () => {
    expect(targetSelector("tasks-new")).toBe(`[${TARGET_ATTR}="tasks-new"]`);
    expect(targetSelector('x"] , body')).toBeNull();
    expect(targetSelector("Tasks-New")).toBeNull();
    expect(targetSelector("")).toBeNull();
  });

  it("needs a size, and nothing hidden, inert or aria-hidden above it", () => {
    expect(isShownTarget(el(80, 32))).toBe(true);
    expect(isShownTarget(el(0, 32))).toBe(false);
    expect(isShownTarget(el(80, 0))).toBe(false);
    expect(isShownTarget(el(80, 32, true))).toBe(false);
  });

  it("treats visibility hidden and display none as hidden", () => {
    expect(isShownTarget(el(80, 32), { visibility: "hidden" })).toBe(false);
    expect(isShownTarget(el(80, 32), { visibility: "collapse" })).toBe(false);
    expect(isShownTarget(el(80, 32), { display: "none" })).toBe(false);
    expect(isShownTarget(el(80, 32), { visibility: "visible", display: "block" })).toBe(true);
  });

  it("takes the first shown one when a key is on the page twice (the two search buttons)", () => {
    const sel = targetSelector("search")!;
    const small = el(0, 0); // the phone's search button, hidden at lg
    const wide = el(320, 36);
    expect(findShownTarget("search", rootOf({ [sel]: [small, wide] }))).toBe(wide);
    expect(findShownTarget("search", rootOf({ [sel]: [small] }))).toBeNull();
    expect(findShownTarget("search", rootOf({}))).toBeNull();
  });

  it("asks the computed style when given one", () => {
    const sel = targetSelector("tasks-new")!;
    const a = el(80, 32), b = el(90, 32);
    const found = findShownTarget("tasks-new", rootOf({ [sel]: [a, b] }), (x) => (x === a ? { visibility: "hidden" } : null));
    expect(found).toBe(b);
  });

  it("finds nothing for a key that isn't one", () => {
    expect(findShownTarget('a"]', rootOf({}))).toBeNull();
  });
});

describe("the label", () => {
  it("is the catalogue's, for every key", () => {
    for (const t of BRENDA_TARGETS) expect(labelFor(t.key)).toBe(t.label);
    expect(labelFor("tasks-new")).toBe("New task");
  });
  it("is nothing for a key the catalogue doesn't know (never the model's words)", () => {
    expect(labelFor("delete-everything")).toBeNull();
    expect(labelFor("")).toBeNull();
  });
  it("gives the pill a rough width before it is measured", () => {
    expect(pillWidth("New task")).toBeGreaterThan(24);
    expect(pillWidth("Screen help on Brenda for Mac")).toBeGreaterThan(pillWidth("New task"));
  });
});

describe("the ring", () => {
  it("is an ellipse round a small control, clear of its corners", () => {
    const r = ringFor({ left: 100, top: 100, width: 32, height: 32 });
    expect(r.shape).toBe("ellipse");
    // The ellipse's box holds the element with at least the gap on every side.
    expect(r.box.left).toBeLessThanOrEqual(100 - RING_PAD);
    expect(r.box.top).toBeLessThanOrEqual(100 - RING_PAD);
    expect(r.box.left + r.box.width).toBeGreaterThanOrEqual(132 + RING_PAD);
    // The element's corner (100,100) is outside the ellipse's edge: (dx/rx)² + (dy/ry)² ≥ 1.
    const cx = r.box.left + r.box.width / 2, cy = r.box.top + r.box.height / 2;
    const rx = r.box.width / 2, ry = r.box.height / 2;
    expect(((100 - cx) / rx) ** 2 + ((100 - cy) / ry) ** 2).toBeLessThan(1);
  });

  it("is a rounded rectangle 6 px clear round anything bigger, its radius at most 16", () => {
    const r = ringFor({ left: 200, top: 50, width: 240, height: 36 });
    expect(r.shape).toBe("rect");
    expect(r.box).toEqual({ left: 194, top: 44, width: 252, height: 48 });
    expect(r.radius).toBe(16);
    expect(ringFor({ left: 0, top: 0, width: 400, height: 10 }).radius).toBe(11);
  });
});

describe("where her face goes", () => {
  const ring: Box = { left: 600, top: 300, width: 120, height: 40 };

  it("starts on her floating button, or at the top middle without one", () => {
    expect(startSpot({ left: 1200, top: 720, width: 56, height: 56 }, VP, 34)).toEqual({ x: 1211, y: 731 });
    expect(startSpot(null, VP, 34)).toEqual({ x: 623, y: 16 });
    expect(startSpot({ left: 0, top: 0, width: 0, height: 0 }, VP, 34)).toEqual({ x: 623, y: 16 });
  });

  it("sits left of the ring, level with its middle", () => {
    expect(faceSpot(ring, VP, 34)).toEqual({ x: 600 - 6 - 34, y: 303 });
  });

  it("moves right when there is no room on the left", () => {
    const left: Box = { left: 10, top: 300, width: 120, height: 40 };
    expect(faceSpot(left, VP, 34)).toEqual({ x: 136, y: 303 });
  });

  it("sits over the top-left corner when neither side has room, and stays on the screen", () => {
    const wide: Box = { left: 20, top: 4, width: 1240, height: 40 };
    const p = faceSpot(wide, VP, 34);
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.x + 34).toBeLessThanOrEqual(VP.width - 8);
  });
});

describe("where the pill goes", () => {
  it("under the ring, centred", () => {
    const p = pillSpot({ left: 600, top: 300, width: 120, height: 40 }, VP, 100);
    expect(p).toEqual({ x: 610, y: 348, side: "below" });
  });
  it("over the ring at the bottom of the screen", () => {
    const p = pillSpot({ left: 600, top: 740, width: 120, height: 40 }, VP, 100);
    expect(p.side).toBe("above");
    expect(p.y).toBe(740 - 8 - 28);
  });
  it("stays inside the screen at the edges", () => {
    const p = pillSpot({ left: 0, top: 100, width: 20, height: 20 }, VP, 200);
    expect(p.x).toBe(8);
    const q = pillSpot({ left: 1270, top: 100, width: 10, height: 20 }, VP, 200);
    expect(q.x + 200).toBeLessThanOrEqual(VP.width - 8);
  });
});

describe("Show me links", () => {
  it("reads the key and the path of an open link", () => {
    expect(pointOfHref("/app/acme/tasks?point=tasks-new")).toEqual({ key: "tasks-new", pathname: "/app/acme/tasks" });
    expect(pointOfHref("/app/acme/settings?section=assistant&point=settings-quiet-hours")).toEqual({ key: "settings-quiet-hours", pathname: "/app/acme/settings" });
  });
  it("ignores links without a known key", () => {
    expect(pointOfHref("/app/acme/tasks")).toBeNull();
    expect(pointOfHref("/app/acme/tasks?point=nope")).toBeNull();
    expect(pointOfHref("/app/acme/tasks?point=")).toBeNull();
  });
});

describe("the marked elements", () => {
  // Every element the contract's table names carries its key (E.1); keys found in the components must be catalogue keys.
  const FILES: Record<string, string[]> = {
    "src/components/app/topbar.tsx": ["search", "notifications"],
    "src/components/app/assistant-drawer.tsx": ["ask-assistant"],
    "src/components/app/tasks-page.tsx": ["tasks-new", "tasks-search"],
    "src/components/app/task-forms.tsx": ["task-edit", "task-blocked"],
    "src/components/app/todo-list.tsx": ["todos-add"],
    "src/components/app/clock.tsx": ["clock-button"],
    "src/components/app/messages.tsx": ["messages-new"],
    "src/components/app/docs-library.tsx": ["docs-new", "docs-search"],
    "src/components/app/people-forms.tsx": ["people-invite"],
    "src/components/app/timesheet-forms.tsx": ["timesheets-export"],
    "src/components/app/assistant-settings.tsx": ["settings-assistant", "settings-permissions"],
    "src/components/app/quiet-hours-settings.tsx": ["settings-quiet-hours"],
    "src/components/app/screen-help-settings.tsx": ["settings-screen-help", "settings-screen-help-mine"],
    "src/app/app/[workspace]/settings/page.tsx": ["settings-notice"],
  };
  const keys = new Set(BRENDA_TARGETS.map((t) => t.key));

  it("marks every non-navigation target in the catalogue", () => {
    const marked = new Set<string>();
    for (const [file, want] of Object.entries(FILES)) {
      const src = readFileSync(file, "utf8");
      for (const k of want) {
        expect(src, `${file} marks ${k}`).toMatch(new RegExp(`(data-brenda-target|target)="${k}"`));
        marked.add(k);
      }
      for (const m of src.matchAll(/(?:data-brenda-target|\btarget)="([a-z0-9-]+)"/g)) {
        if (m[1] === "_blank") continue;
        expect(keys.has(m[1]), `${file}: ${m[1]} is a catalogue key`).toBe(true);
      }
    }
    for (const t of BRENDA_TARGETS) if (!t.key.startsWith("nav-")) expect(marked.has(t.key), `${t.key} is marked`).toBe(true);
  });

  it("marks the sidebar's items through the catalogue", () => {
    const src = readFileSync("src/components/app/sidebar.tsx", "utf8");
    expect(src).toContain("data-brenda-target={navTarget(it.href)}");
    expect(src).toContain("isTargetKey");
  });
});
