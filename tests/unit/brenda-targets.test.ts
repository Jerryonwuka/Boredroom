import { describe, it, expect } from "vitest";
import {
  BRENDA_TARGETS, POINT_PARAM, TARGET_ATTR, isTargetKey, pointingLine, readPointParam, targetFor, targetsForRole, withoutPointParam,
} from "@/lib/brenda-targets";

// Brenda points inside Boredroom (owner request, 11 October 2026; contract E.1, D.12): the catalogue of what she may
// point at, read by the copilot, the open_page check, the web pointer and the notch's Show me. Pure.

const NAV = ["home", "dashboard", "my-day", "todos", "clock", "attendance", "workroom", "tasks", "commitments", "messages", "calls", "docs", "reviews", "timesheets", "projects", "people", "settings", "audit"];
const PAGES = ["search", "notifications", "ask-assistant", "tasks-new", "tasks-search", "task-edit", "task-blocked", "todos-add", "clock-button", "messages-new", "docs-new", "docs-search",
  "people-invite", "timesheets-export", "settings-assistant", "settings-permissions", "settings-quiet-hours", "settings-screen-help-mine", "settings-screen-help", "settings-notice"];

describe("the catalogue (contract E.1)", () => {
  it("has every key of the contract, once each, in [a-z0-9-]", () => {
    const keys = BRENDA_TARGETS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...NAV.map((s) => `nav-${s}`), ...PAGES].sort());
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
    expect(TARGET_ATTR).toBe("data-brenda-target");
    expect(POINT_PARAM).toBe("point");
  });

  it("every target has a label, a page under the workspace, a phrase for the model and at least one role", () => {
    for (const t of BRENDA_TARGETS) {
      expect(t.label.trim(), t.key).toBe(t.label);
      expect(t.label.length).toBeGreaterThan(1);
      expect(t.page).toMatch(/^\/[a-z0-9\-/<>?=]*$/);
      expect(t.what.length).toBeGreaterThan(5);
      expect(t.roles.length).toBeGreaterThan(0);
    }
    expect(BRENDA_TARGETS.filter((t) => t.anywhere).map((t) => t.key).sort()).toEqual([...NAV.map((s) => `nav-${s}`), "search", "notifications", "ask-assistant"].sort());
  });

  it("the roles follow the pages and buttons", () => {
    const keysOf = (r: Parameters<typeof targetsForRole>[0]) => targetsForRole(r).map((t) => t.key);
    expect(keysOf("employee")).toContain("todos-add");
    expect(keysOf("employee")).not.toContain("tasks-new");
    expect(keysOf("employee")).not.toContain("settings-screen-help");
    expect(keysOf("employee")).toContain("settings-screen-help-mine");
    expect(keysOf("manager")).toContain("tasks-new");
    expect(keysOf("owner")).toContain("people-invite");
    expect(keysOf("owner")).toContain("settings-screen-help");
    expect(keysOf("owner")).not.toContain("clock-button");
    expect(keysOf("hr")).toContain("settings-notice");
  });

  it("isTargetKey and targetFor know only the catalogue's own keys", () => {
    expect(isTargetKey("tasks-new")).toBe(true);
    for (const v of ["nope", "", "TASKS-NEW", "constructor", "__proto__", 5, null, undefined]) expect(isTargetKey(v)).toBe(false);
    expect(targetFor("todos-add")?.label).toBe("Add a to-do");
    expect(targetFor("constructor")).toBeNull();
  });
});

describe("the point parameter", () => {
  it("readPointParam: a known key or null, from a query string or a whole address", () => {
    expect(readPointParam("?point=tasks-new")).toBe("tasks-new");
    expect(readPointParam("point=tasks-new&x=1")).toBe("tasks-new");
    expect(readPointParam("/app/a/settings?section=assistant&point=settings-quiet-hours#routines")).toBe("settings-quiet-hours");
    expect(readPointParam("?point=nope")).toBeNull();
    expect(readPointParam("?x=1")).toBeNull();
    expect(readPointParam("")).toBeNull();
  });

  it("withoutPointParam removes it and keeps everything else", () => {
    expect(withoutPointParam("/app/a/tasks?point=tasks-new")).toBe("/app/a/tasks");
    expect(withoutPointParam("/app/a/settings?section=assistant&point=settings-quiet-hours#routines")).toBe("/app/a/settings?section=assistant#routines");
    expect(withoutPointParam("/app/a/settings?point=x&section=brenda")).toBe("/app/a/settings?section=brenda");
    expect(withoutPointParam("/app/a/tasks?pointer=1")).toBe("/app/a/tasks?pointer=1");
    expect(withoutPointParam("/app/a/tasks")).toBe("/app/a/tasks");
  });
});

describe("the situation's line (contract D.12)", () => {
  it("names each place the role has, with its page and key, and how to point", () => {
    const line = pointingLine("employee");
    expect(line.startsWith("Places you can point at in Boredroom: ")).toBe(true);
    expect(line).toContain("Add a to-do on /todos (todos-add)");
    expect(line).toContain("Search on every page (search)");
    expect(line).not.toContain("(tasks-new)");
    expect(line.endsWith("When the person asks how to do something here or where something is, say in one sentence what to press, and call open_page with that place's page and ?point=<key> (or &point= when the path already has a ?): Boredroom opens the page and points at it.")).toBe(true);
    expect(line).not.toContain("\n");
  });
});
