/**
 * Reading a SKILL.md (owner decisions, 4 November 2026: skills, phase 1). The format Anthropic's skills use: a front
 * matter block between `---` lines with `name` and `description` (and, here, an optional `title`), then the instructions.
 * Only flat `key: value` lines are read (quoted or not, and `>` / `|` blocks for a long description); anything else in
 * the front matter is ignored. No YAML library: nothing in it can run code or pull in files. Pure.
 */

export const SKILL_BODY_MAX = 50_000;
export const SKILL_USE_WHEN_MAX = 200;
export const SKILL_NAME_MAX = 60;
export const SKILL_FILES_MAX = 5;
export const SKILL_FILES_BYTES = 200_000;
export const SKILL_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export type ParsedSkill = { slug: string; name: string; useWhen: string; body: string };
export type SkillProblem = { field: "skill" | "name" | "description" | "body" | "files"; words: string };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** "weekly report" → "weekly-report"; null when nothing is left. */
export function slugOf(s: string): string | null {
  const v = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return SLUG.test(v) ? v : null;
}

/** "weekly-report" → "Weekly report". */
export function nameOf(slug: string): string {
  const s = slug.replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    return t[0] === '"' ? t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/** The front matter's flat keys. */
export function frontMatter(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let value = m[2];
    if (/^[>|][+-]?\s*$/.test(value)) {
      const folded = value.startsWith(">");
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      value = folded ? block.join(" ").replace(/\s+/g, " ") : block.join("\n");
    } else {
      value = unquote(value);
    }
    if (!(key in out)) out[key] = value.trim();
  }
  return out;
}

/** A SKILL.md as a skill, or the problems people see. */
export function parseSkillMd(text: string): { skill: ParsedSkill } | { problems: SkillProblem[] } {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/);
  if (!m) return { problems: [{ field: "skill", words: "Start the file with a front matter block: a line with ---, name: and description:, then --- again." }] };
  const fm = frontMatter(m[1].split("\n"));
  const body = m[2].trim();
  const problems: SkillProblem[] = [];
  const slug = slugOf(fm.name ?? "");
  if (!slug) problems.push({ field: "name", words: "Give the skill a name: (letters, numbers and dashes)." });
  const name = (fm.title || (slug ? nameOf(slug) : "")).replace(/\s+/g, " ").trim();
  if (name.length > SKILL_NAME_MAX || CONTROL.test(name)) problems.push({ field: "name", words: `Keep the title to ${SKILL_NAME_MAX} characters.` });
  const useWhen = (fm.description ?? "").replace(/\s+/g, " ").trim();
  if (!useWhen) problems.push({ field: "description", words: "Add a description: saying when Brenda should use it." });
  else if (useWhen.length > SKILL_USE_WHEN_MAX || CONTROL.test(useWhen)) problems.push({ field: "description", words: `Keep the description to ${SKILL_USE_WHEN_MAX} characters.` });
  if (!body) problems.push({ field: "body", words: "Write the instructions under the front matter." });
  else if (body.length > SKILL_BODY_MAX || CONTROL.test(body)) problems.push({ field: "body", words: `Keep the instructions to ${SKILL_BODY_MAX.toLocaleString("en-GB")} characters of plain text.` });
  if (problems.length || !slug) return { problems };
  return { skill: { slug, name, useWhen, body } };
}

/** Reference files: up to 5, plain text, 200 KB in all, names unique. */
export function checkSkillFiles(files: { name: unknown; text: unknown }[]): { files: { name: string; text: string }[] } | { problems: SkillProblem[] } {
  if (files.length > SKILL_FILES_MAX) return { problems: [{ field: "files", words: `A skill can have up to ${SKILL_FILES_MAX} files.` }] };
  const out: { name: string; text: string }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    const name = typeof f.name === "string" ? f.name.trim() : "";
    const text = typeof f.text === "string" ? f.text.replace(/\r\n?/g, "\n") : "";
    if (!SKILL_FILE_NAME.test(name) || name.toLowerCase() === "skill.md") return { problems: [{ field: "files", words: "Name each file with letters, numbers, spaces, dots and dashes (not SKILL.md)." }] };
    if (seen.has(name.toLowerCase())) return { problems: [{ field: "files", words: `Two files are called ${name}.` }] };
    if (!text.trim() || CONTROL.test(text)) return { problems: [{ field: "files", words: `${name} isn't plain text.` }] };
    seen.add(name.toLowerCase());
    total += Buffer.byteLength(text, "utf8");
    out.push({ name, text });
  }
  if (total > SKILL_FILES_BYTES) return { problems: [{ field: "files", words: "A skill's files can be 200 KB in all." }] };
  return { files: out };
}
