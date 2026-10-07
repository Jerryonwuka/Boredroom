import { describe, it, expect } from "vitest";
import { speakable } from "@/lib/assistant-speech/speakable";
import { createEnvelope } from "@/lib/assistant-speech/envelope";
import { NOVELTY_VOICES, localVoices, pickVoice, type BrowserVoice, type LocalVoice } from "@/lib/assistant-speech/voices";

// Her voice (owner decision, 7 October 2026: personal assistants, phase 2): what she says out loud, the made-up level
// her eyes follow while she says it, and which of the device's voices she may use. The controller itself needs a
// browser (speechSynthesis), so it is not imported here; these are its pure parts.

const FORBIDDEN = /[*_`#|[\]<>]/;

/** A small seeded generator (mulberry32), so the made-up syllables are the same on every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("speakable: the examples", () => {
  it("drops emphasis and keeps the words", () => {
    expect(speakable("You have **5 overdue tasks**.")).toBe("You have 5 overdue tasks.");
  });

  it("says list items as short sentences after the opening prose", () => {
    expect(speakable("You have 3 tasks.\n\n- **Landing page copy**, due Fri 9 Oct, 17:00\n- **Invoice** for Acme\n- Call Josh"))
      .toBe("You have 3 tasks. Landing page copy, due Fri 9 Oct, 17:00. Invoice for Acme. Call Josh.");
  });

  it("says a link's words, never its address", () => {
    expect(speakable("Done. [Open the task](/app/acme/tasks/2b1f0c9e-1111-4c4c-8888-123456789abc)")).toBe("Done. Open the task.");
  });

  it("speaks only the prose of a reply with a code block and a table", () => {
    const reply = [
      "Here is the query.",
      "",
      "```sql",
      "SELECT * FROM tasks WHERE due < now();",
      "```",
      "",
      "| Task | Due |",
      "|---|---|",
      "| Invoice | Fri |",
      "",
      "It runs in a second.",
    ].join("\n");
    expect(speakable(reply)).toBe("Here is the query. It runs in a second.");
  });

  it("ends a long list with how many were left out, within 400 characters", () => {
    const items = Array.from({ length: 12 }, (_, i) => `- ${`Task number ${String(i + 1).padStart(2, "0")} `.padEnd(50, "x")}`);
    expect(items[0].length).toBe(52);
    const said = speakable(items.join("\n"));
    expect(said).toMatch(/And \d+ more\.$/);
    expect(said.length).toBeLessThanOrEqual(400);
    const left = Number(/And (\d+) more\.$/.exec(said)![1]);
    const read = said.split(/(?<=\.)\s+/).filter((s) => s.startsWith("Task number")).length;
    expect(read + left).toBe(12);
  });

  it("cuts a single 900-character sentence to 400 characters, ending with a full stop", () => {
    const long = `${"Word ".repeat(180).trim()}.`;
    expect(long.length).toBeGreaterThan(890);
    const said = speakable(long);
    expect(said.length).toBeLessThanOrEqual(400);
    expect(said).toMatch(/\.$/);
    expect(said.length).toBeGreaterThan(300);
  });

  it("never reads a URL", () => {
    const said = speakable("See https://example.com/x?y=1 for details.");
    expect(said).not.toContain("http");
    expect(said).not.toContain("example.com");
    expect(said).not.toContain("?y=1");
    expect(said).toMatch(/for details\.$/);
  });

  it("never reads a token", () => {
    const said = speakable("Your token is 9f8e7d6c5b4a39281706f5e4d3c2b1a0.");
    expect(said).not.toMatch(/9f8e|d6c5b4|2b1a0/);
    expect(said).toBe("Your token is.");
  });
});

describe("speakable: the rules", () => {
  it("is empty for nothing", () => {
    expect(speakable("")).toBe("");
    expect(speakable("   \n\n\t ")).toBe("");
    expect(speakable("```\ncode only\n```")).toBe("");
    expect(speakable("https://example.com")).toBe("");
  });

  it("keeps to three prose sentences by default, or as asked", () => {
    expect(speakable("One. Two. Three. Four.")).toBe("One. Two. Three.");
    expect(speakable("One. Two. Three. Four.", { maxSentences: 1 })).toBe("One.");
  });

  it("joins the lines of a paragraph and ends sentences with a full stop", () => {
    expect(speakable("Here is\nwhat I found")).toBe("Here is what I found.");
    expect(speakable("First paragraph\n\nSecond paragraph")).toBe("First paragraph. Second paragraph.");
    expect(speakable("Really? Yes!")).toBe("Really? Yes!");
  });

  it("turns headings and bold lines into labels, kept only with an item of theirs", () => {
    expect(speakable("## Overdue\n- Invoice\n- Call Josh")).toBe("Overdue: Invoice. Call Josh.");
    expect(speakable("**Done:**\n- Invoice")).toBe("Done: Invoice.");
    expect(speakable("**Done**\n- Invoice")).toBe("Done: Invoice.");
    expect(speakable("## Summary\nYou did well.")).toBe("You did well.");
    expect(speakable("You did well.\n\n**Next**")).toBe("You did well.");
  });

  it("flattens nested lists and drops numbers, bullets and checkboxes", () => {
    expect(speakable("- Plan\n  - Draft\n    - Review\n- Ship")).toBe("Plan. Draft. Review. Ship.");
    expect(speakable("1. First\n2) Second\n• Third\n+ Fourth\n* Fifth")).toBe("First. Second. Third. Fourth. Fifth.");
    expect(speakable("- [ ] Call Josh\n- [x] Send invoice")).toBe("Call Josh. Send invoice.");
    expect(speakable("- Already ends!\n- Ends with a colon:\n- Trailing comma,")).toBe("Already ends! Ends with a colon: Trailing comma.");
  });

  it("carries an indented line on with its list item", () => {
    expect(speakable("- Landing page copy\n  due Friday")).toBe("Landing page copy due Friday.");
  });

  it("does not count list items against the sentence cap", () => {
    expect(speakable("One. Two. Three. Four.\n\n- A\n- B")).toBe("One. Two. Three. A. B.");
  });

  it("drops code spans, images, HTML, footnotes, rules and quotes' marks", () => {
    expect(speakable("Run `pnpm test` now.")).toBe("Run now.");
    expect(speakable("![A chart](https://x.test/c.png) Here it is.")).toBe("Here it is.");
    expect(speakable("<b>Hi</b> there<br/>")).toBe("Hi there.");
    expect(speakable("Noted[^1] for later.")).toBe("Noted for later.");
    expect(speakable("Above.\n\n---\n\nBelow.")).toBe("Above. Below.");
    expect(speakable("> Quoted words")).toBe("Quoted words.");
    expect(speakable("~~Old~~ New _plan_ and __more__")).toBe("Old New plan and more.");
  });

  it("drops tables without leading pipes too", () => {
    expect(speakable("Your week.\n\nTask | Due\n--- | ---\nInvoice | Fri\n\nThat is all.")).toBe("Your week. That is all.");
  });

  it("never reads paths, email addresses, ids or autolinks", () => {
    expect(speakable("It is at /app/acme/tasks/123 now.")).toBe("It is at now.");
    expect(speakable("Ask josh@acme.test about it.")).toBe("Ask about it.");
    expect(speakable("Task 2b1f0c9e-1111-4c4c-8888-123456789abc is done.")).toBe("Task is done.");
    expect(speakable("Open <https://example.com/a> or (https://example.com/b).")).toBe("Open or.");
    expect(speakable("Go to www.example.com.")).toBe("Go to.");
    expect(speakable("The id is task_2b1f0c9e1111_4c4c8888.")).not.toMatch(/2b1f|4c4c/);
  });

  it("reads snake_case words as words and drops emoji", () => {
    expect(speakable("The field due_date is set.")).toBe("The field due date is set.");
    expect(speakable("All done 🎉✅ well done 👍🏽!")).toBe("All done well done!");
  });

  it("treats backslash escapes as text, never as Markdown", () => {
    expect(speakable("1\\. Not a list")).toBe("1. Not a list.");
    expect(speakable("\\# Not a heading")).toBe("Not a heading.");
    expect(speakable("\\- Not an item either")).toBe("- Not an item either.");
    expect(speakable("5 \\* 3 is 15")).toBe("5 3 is 15.");
  });

  it("tidies what removals leave behind", () => {
    expect(speakable("Open [the doc](https://x.test/d) .")).toBe("Open the doc.");
    expect(speakable("Saved (see https://x.test/a).")).toBe("Saved (see).");
    expect(speakable("Saved (https://x.test/a).")).toBe("Saved.");
    expect(speakable("Link: https://x.test/a.")).toBe("Link.");
  });

  it("cuts a first item that is too long on its own, and says how many more", () => {
    const said = speakable(`- ${"Long words here, ".repeat(40)}end\n- Second\n- Third`);
    expect(said.length).toBeLessThanOrEqual(400);
    expect(said).toMatch(/\. And 2 more\.$/);
  });

  const samples = [
    "# Title\n\n**Bold** and *italic* and `code` and [link](https://x.test) and <i>html</i> | pipes | here",
    "| a | b |\n|---|---|\n| 1 | 2 |",
    "- **A**: one\n- __B__: two\n  - *C*: three\n\n> quote with `code`\n\n```\nfenced\n```",
    "Escapes: \\* \\_ \\` \\# \\| \\[ \\] \\< \\>",
    "Ids: 123e4567-e89b-12d3-a456-426614174000, tok_abcdefghijklmnopqrstu12345, a_b_c, x*y*z",
    `${"- An item that goes on for quite a while, with commas, clauses; and more\n".repeat(30)}`,
    `${"Sentence number one goes here. ".repeat(40)}`,
    "x".repeat(1200),
  ];

  it("never says a Markdown character", () => {
    for (const s of samples) expect(speakable(s)).not.toMatch(FORBIDDEN);
  });

  it("always fits maxChars", () => {
    for (const s of samples) {
      for (const maxChars of [400, 120, 40]) expect(speakable(s, { maxChars }).length).toBeLessThanOrEqual(maxChars);
    }
  });
});

// Review, 7 October 2026: what the first rules still let through, and the server's event loop.
describe("speakable: never URLs, entities or paths", () => {
  it("drops a URL with no scheme (a host with a path or a query)", () => {
    expect(speakable("Visit example.com/path?x=1 or acme.boredroom.app/app/x now.")).toBe("Visit or now.");
    expect(speakable("See docs.example.org?page=2.")).toBe("See.");
  });

  it("keeps what only looks like one: a score, a file at the end of a question", () => {
    expect(speakable("Rated 3.5/5 by most people.")).toBe("Rated 3.5/5 by most people.");
    expect(speakable("Did you upload budget.xlsx?")).toBe("Did you upload budget.xlsx?");
  });

  it("decodes HTML entities", () => {
    expect(speakable("Html &lt;b&gt; entity &#39;x&#39; &amp; &#x2019;y&rsquo; &hellip;")).toBe("Html b entity 'x' & ’y’…");
  });

  it("drops Windows paths", () => {
    expect(speakable("Saved to C:\\Users\\jane\\secret.txt today.")).toBe("Saved to today.");
  });
});

describe("speakable: linear time", () => {
  // Each once took up to two seconds at this size (the email and link patterns rescanned from every position).
  const long = 30000;
  const inputs = {
    letters: "a".repeat(long),
    brackets: "[".repeat(long),
    images: "![".repeat(long / 2),
    bold: `**${"a".repeat(long)}*`,
    ats: "a@".repeat(long / 2),
    hosts: "a.bc/".repeat(long / 5),
    backslashes: "\\".repeat(long),
    lines: "a\n".repeat(long / 2),
  };
  for (const [name, input] of Object.entries(inputs)) {
    it(`reads ${long} characters of ${name} in under 50 ms`, () => {
      speakable(input); // warm up
      const t = performance.now();
      speakable(input);
      expect(performance.now() - t).toBeLessThan(50);
    });
  }

  it("still says the opening of a very long reply", () => {
    expect(speakable(`Here is the summary.\n\n${"More detail goes here. ".repeat(2000)}`)).toBe("Here is the summary. More detail goes here. More detail goes here.");
  });
});

describe("speech envelope", () => {
  /** The local peaks of the level above `above`, sampled every millisecond from `from` to `to`. */
  function peaks(level: (t: number) => number, from: number, to: number, above: number): number[] {
    const out: number[] = [];
    let prev = level(from - 1);
    let cur = level(from);
    for (let t = from; t < to; t++) {
      const next = level(t + 1);
      if (cur > prev && cur >= next && cur > above) out.push(t);
      prev = cur;
      cur = next;
    }
    return out;
  }

  it("is 0 before the start and after stop, and always within 0 to 1", () => {
    const env = createEnvelope(seeded(1));
    expect(env.level(0)).toBe(0);
    env.start(100);
    expect(env.level(50)).toBe(0);
    for (let t = 100; t < 3000; t += 7) {
      if (t % 250 < 7) env.boundary(t, (t % 11) + 1);
      const l = env.level(t);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
    }
    env.stop();
    expect(env.level(3000)).toBe(0);
    expect(env.level(1000)).toBe(0);
  });

  it("never lets her eyes shut while she speaks", () => {
    const env = createEnvelope(seeded(2));
    env.start(0);
    expect(env.level(1)).toBeGreaterThanOrEqual(0.08);
  });

  it("rises within 40 ms of a word and falls below 0.3 by 300 ms later", () => {
    for (const length of [1, 4, 5, 6, 12, undefined]) {
      const env = createEnvelope(seeded(3));
      env.start(0);
      env.boundary(100, length);
      expect(Math.max(env.level(130), env.level(135), env.level(140))).toBeGreaterThanOrEqual(0.5);
      expect(env.level(400)).toBeLessThan(0.3);
    }
  });

  it("makes up 4 to 6 syllables a second when no word boundaries arrive", () => {
    for (const seed of [4, 5, 6]) {
      const env = createEnvelope(seeded(seed));
      env.start(0);
      const n = peaks((t) => env.level(t), 0, 2000, 0.4).length;
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(12);
    }
  });

  it("lets steady word boundaries suppress the made-up syllables", () => {
    const words = Array.from({ length: 8 }, (_, i) => i * 250);
    // Short words: exactly one peak per word, 35 ms after it.
    const short = createEnvelope(seeded(7));
    short.start(0);
    for (const t of words) short.boundary(t, 4);
    expect(peaks((t) => short.level(t), 0, 2000, 0.2)).toEqual(words.map((t) => t + 35));
    // Long words: a second, smaller syllable 170 ms after each, and nothing else.
    const long = createEnvelope(seeded(8));
    long.start(0);
    for (const t of words) long.boundary(t, 7);
    expect(peaks((t) => long.level(t), 0, 2000, 0.2)).toEqual(words.flatMap((t) => [t + 35, t + 205]));
  });

  it("is the same at a time however often it is read", () => {
    const env = createEnvelope(seeded(9));
    env.start(0);
    const late = env.level(1500);
    const early = env.level(700);
    expect(env.level(1500)).toBe(late);
    expect(env.level(700)).toBe(early);
  });
});

describe("local voices", () => {
  const v = (name: string, lang: string, extra: Partial<BrowserVoice> = {}): BrowserVoice =>
    ({ voiceURI: `uri:${name}`, name, lang, localService: true, default: false, ...extra });

  it("keeps only voices on this device, without macOS's novelty voices, sorted by name", () => {
    const voices = localVoices([
      v("Samantha", "en-US", { default: true }),
      v("Google UK English Female", "en-GB", { localService: false }),
      v("Microsoft Libby Online (Natural)", "en-GB", { localService: false }),
      v("Zarvox", "en-US"),
      v("bad news", "en-US"),
      v("Bubbles (English (United States))", "en-US"),
      v("Daniel", "en-GB"),
      v("Amélie", "fr-CA"),
      v("Daniel", "en-GB"), // listed twice
    ]);
    expect(voices.map((x) => x.name)).toEqual(["Amélie", "Daniel", "Samantha"]);
    expect(voices.find((x) => x.name === "Samantha")).toEqual({ voiceURI: "uri:Samantha", name: "Samantha", lang: "en-US", isDefault: true });
    expect(NOVELTY_VOICES.has("Zarvox")).toBe(true);
  });

  const voices: LocalVoice[] = [
    { voiceURI: "fr", name: "Thomas", lang: "fr-FR", isDefault: false },
    { voiceURI: "us", name: "Samantha", lang: "en-US", isDefault: false },
    { voiceURI: "gb", name: "Daniel", lang: "en_GB", isDefault: false },
    { voiceURI: "au", name: "Karen", lang: "en-AU", isDefault: false },
  ];

  it("uses the chosen voice while it is still on the device", () => {
    expect(pickVoice(voices, { voiceURI: "fr", langs: ["en-GB"] })?.voiceURI).toBe("fr");
  });

  it("falls back to the best for the language when the chosen voice is gone", () => {
    expect(pickVoice(voices, { voiceURI: "gone", langs: ["en-GB"] })?.voiceURI).toBe("gb");
  });

  it("prefers an exact language match, case-insensitively, then the same base language", () => {
    expect(pickVoice(voices, { langs: ["en-GB"] })?.voiceURI).toBe("gb");
    expect(pickVoice(voices, { langs: ["EN-us"] })?.voiceURI).toBe("us");
    expect(pickVoice(voices, { langs: ["en-NZ"] })?.voiceURI).toBe("us");
    expect(pickVoice(voices, { langs: ["en-NZ", "en-AU"] })?.voiceURI).toBe("au");
  });

  it("prefers the device's default voice when it speaks the language", () => {
    const withDefault = voices.map((x) => ({ ...x, isDefault: x.voiceURI === "au" }));
    expect(pickVoice(withDefault, { langs: ["en-GB"] })?.voiceURI).toBe("au");
    const frenchDefault = voices.map((x) => ({ ...x, isDefault: x.voiceURI === "fr" }));
    expect(pickVoice(frenchDefault, { langs: ["en-GB"] })?.voiceURI).toBe("gb");
    expect(pickVoice(frenchDefault, { langs: ["de-DE"] })?.voiceURI).toBe("fr");
    expect(pickVoice(frenchDefault, { langs: [] })?.voiceURI).toBe("fr");
  });

  it("is null with no voices", () => {
    expect(pickVoice([], { voiceURI: "gb", langs: ["en-GB"] })).toBeNull();
  });
});
