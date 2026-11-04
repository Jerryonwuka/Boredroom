import { describe, expect, it, vi } from "vitest";

// Skills (owner decisions, 4 November 2026: phase 1): reading a SKILL.md, the reference files' limits, and the starter
// skills, which may only name tools Brenda really has.

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import { checkSkillFiles, frontMatter, nameOf, parseSkillMd, slugOf } from "@/server/skills/parse";
import { BUILTIN_SKILLS } from "@/server/skills/builtin";
import { ACTION_TOOLS, ALWAYS_CONFIRM, PARALLEL_READS, TOOLS } from "@/server/services/copilot";
import { AUTO_RULES } from "@/server/services/act-decision";

describe("parseSkillMd", () => {
  it("reads name, title and description from the front matter, and the instructions under it", () => {
    const r = parseSkillMd("---\nname: Weekly Report\ntitle: \"My weekly report\"\ndescription: >\n  When the person asks\n  for their week.\nallowed-tools: x\n---\n\n# Steps\n1. Do it.\n");
    expect(r).toEqual({ skill: { slug: "weekly-report", name: "My weekly report", useWhen: "When the person asks for their week.", body: "# Steps\n1. Do it." } });
  });

  it("names it from its slug without a title, and takes Windows line ends and a BOM", () => {
    expect(parseSkillMd("﻿---\r\nname: client-update\r\ndescription: 'For client updates'\r\n---\r\nBody")).toEqual({ skill: { slug: "client-update", name: "Client update", useWhen: "For client updates", body: "Body" } });
  });

  it("says what's missing", () => {
    expect(parseSkillMd("just text")).toMatchObject({ problems: [{ field: "skill" }] });
    const r = parseSkillMd("---\ndescription: x\n---\n");
    expect("problems" in r && r.problems.map((p) => p.field)).toEqual(["name", "body"]);
    expect(parseSkillMd(`---\nname: a\ndescription: ${"x".repeat(201)}\n---\nb`)).toMatchObject({ problems: [{ field: "description" }] });
    expect(parseSkillMd(`---\nname: a\ndescription: d\n---\n${"x".repeat(50_001)}`)).toMatchObject({ problems: [{ field: "body" }] });
    expect(parseSkillMd("---\nname: a\ndescription: d\n---\nbad \u0007 bell")).toMatchObject({ problems: [{ field: "body" }] });
  });

  it("reads only flat keys, the first of each", () => {
    expect(frontMatter(["name: a", "name: b", "nested:", "  - x", "description: |", "  one", "  two"])).toEqual({ name: "a", nested: "", description: "one\ntwo" });
    expect(slugOf("  Café  Notes!! ")).toBe("cafe-notes");
    expect(slugOf("!!!")).toBeNull();
    expect(nameOf("prepare-one-to-one")).toBe("Prepare one to one");
  });
});

describe("checkSkillFiles", () => {
  it("takes up to five plain-text files with good, unique names, 200 KB in all", () => {
    expect(checkSkillFiles([{ name: "template.md", text: "a\r\nb" }])).toEqual({ files: [{ name: "template.md", text: "a\nb" }] });
    expect(checkSkillFiles(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.md`, text: "x" })))).toMatchObject({ problems: [{ field: "files" }] });
    expect(checkSkillFiles([{ name: "a.md", text: "x" }, { name: "A.md", text: "y" }])).toMatchObject({ problems: [{ field: "files" }] });
    expect(checkSkillFiles([{ name: "SKILL.md", text: "x" }])).toMatchObject({ problems: [{ field: "files" }] });
    expect(checkSkillFiles([{ name: "../etc", text: "x" }])).toMatchObject({ problems: [{ field: "files" }] });
    expect(checkSkillFiles([{ name: "big.txt", text: "x".repeat(200_001) }])).toMatchObject({ problems: [{ field: "files" }] });
  });
});

describe("the starter skills", () => {
  const tools = new Set((TOOLS as { name: string }[]).map((t) => t.name));

  it("are six, with unique slugs, short enough for the situation, and every tool they name is real", () => {
    expect(BUILTIN_SKILLS.map((s) => s.slug)).toEqual(["weekly-report", "prepare-one-to-one", "onboard-teammate", "triage-work-items", "plan-my-week", "client-update"]);
    for (const s of BUILTIN_SKILLS) {
      expect(parseSkillMd(`---\nname: ${s.slug}\ntitle: ${s.name}\ndescription: ${s.useWhen}\n---\n${s.body}`), s.slug).toEqual({ skill: { slug: s.slug, name: s.name, useWhen: s.useWhen, body: s.body } });
      for (const named of s.body.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) expect(tools.has(named), `${s.slug}: ${named}`).toBe(true);
    }
  });
});

describe("the app tools' approvals", () => {
  it("acting always confirms, never runs on its own, and is never a parallel read; reading is", () => {
    expect(ALWAYS_CONFIRM.has("act_with_app_tool") && ACTION_TOOLS.has("act_with_app_tool")).toBe(true);
    expect(AUTO_RULES.act_with_app_tool({})).toBe("always_asks");
    expect(PARALLEL_READS.has("act_with_app_tool")).toBe(false);
    for (const n of ["app_tools", "use_app_tool", "read_skill"]) {
      expect(PARALLEL_READS.has(n), n).toBe(true);
      expect(ACTION_TOOLS.has(n), n).toBe(false);
    }
  });
});
