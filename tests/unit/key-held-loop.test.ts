/**
 * Owner report, 27 October 2026: "Sometimes when I tell her to do stuff, she says I should confirm for her to do it by
 * holding down the keys and saying it again, but when I do that she doesn't do it and just repeats what she said."
 *
 * Where the sentence came from: a look from a front-capable Mac (the router sends "this" and "that" to a look, and the
 * Mac sends words its verb list misses to a look or the chat) had no way to act and was told to "say … that you'll do it
 * if they ask you again with their keys"; the chat from the Mac said "or they can hold Control+Command and ask". Asked
 * again, the same words went the same way. Now no prompt the Mac's turns get sends them back to their keys, and a front
 * look whose words ask for something proposes it (the Yes/No card; Yes runs it). The Mac side is in Rust
 * (front::tests::key_held_requests_reach_the_router, intent::tests::what_reaches_the_router).
 */
import { describe, expect, it } from "vitest";
import {
  FRONT_LOOK_LINE, LOOK_TOOLS_FRONT, MAC_CHAT_LINE, NEVER_ASK_AGAIN_LINE, WEB_MAC_LINE, lookSituationV2, lookToolsFor,
} from "@/server/services/copilot";

const S = { mediaType: "image/jpeg" as const, data: "", width: 1568, height: 1019, pointer: { x: 980, y: 214 } };
const C = { mediaType: "image/jpeg" as const, data: "", width: 896, height: 896, pointer: { x: 448, y: 448 } };
const look = { source: "keys" as const, screen: S, crop: C, app: { name: "Finder", bundleId: "com.apple.finder" }, hidden: [] as string[], abilities: { useMac: true, fileWork: true, busy: null }, files: [] };

/** Words that send the person back to their keys to repeat themselves. */
const SEND_BACK = /ask (you|me|her) again with (their|your) keys|hold (control\+command|⌃ ⌘|the keys|your keys)[^.]*\band ask\b|(say|ask) it again/i;
/** The text with the rule against it taken out (the rule itself names what it forbids). */
const said = (s: string) => s.split(NEVER_ASK_AGAIN_LINE).join("");
const names = (ts: readonly { name?: string }[]) => ts.map((t) => t.name);

describe("she never asks for a key-held repeat (owner report, 27 October 2026)", () => {
  it("a front look whose words ask for something proposes it for a Yes or No, and never sends them back to their keys", () => {
    for (const plans of [false, true]) {
      const s = lookSituationV2({ look, act: true, asked: true, name: "Brenda", plans, front: true });
      expect(said(s)).not.toMatch(SEND_BACK);
      expect(s).toContain(FRONT_LOOK_LINE);
      expect(s).toContain("call propose_task once");
      expect(s).toContain("Do you want me to do this?");
      expect(s).toContain("Boredroom changes you prepare wait for their Confirm, except their own to-do, reminder or timer when their words ask for it.");
      expect(s).not.toContain("Anything you do from this look waits for the person's Confirm");
    }
    // The quick model gets propose_task (think_harder still last); the stronger one too.
    expect(names(lookToolsFor({ front: { quick: true }, asked: true, plans: false }))).toContain("propose_task");
    expect(names(lookToolsFor({ front: { quick: false }, asked: true, plans: true }))).toContain("propose_task");
  });

  it("a front look that is only a question answers it, with no task and no repeat", () => {
    const s = lookSituationV2({ look, act: true, asked: false, name: "Brenda", front: true });
    expect(said(s)).not.toMatch(SEND_BACK);
    expect(s).toContain("They asked a question, not for something to be done");
    expect(s).not.toContain("propose_task once");
    expect(lookToolsFor({ front: { quick: true }, asked: false, plans: false })).toEqual(LOOK_TOOLS_FRONT);
  });

  it("a front look where tasks aren't available says why, never 'ask again'", () => {
    for (const reason of ["switched_off", "not_ready", null] as const) {
      const s = lookSituationV2({ look, act: false, asked: false, name: "Brenda", front: true, reason });
      expect(said(s)).not.toMatch(SEND_BACK);
      expect(s).toContain(NEVER_ASK_AGAIN_LINE);
    }
  });

  it("chat from the Mac offers the button under her reply, never the keys again", () => {
    expect(said(MAC_CHAT_LINE)).not.toMatch(SEND_BACK);
    expect(MAC_CHAT_LINE).toContain("call use_my_screen");
    expect(MAC_CHAT_LINE).toContain(NEVER_ASK_AGAIN_LINE);
    expect(NEVER_ASK_AGAIN_LINE).toBe("Never tell them to hold your keys, press Control+Command or Option+Space, or ask or say it again to get something done: they already asked you.");
    // The browser is different: there Brenda for Mac really is somewhere else (they haven't held any keys yet).
    expect(WEB_MAC_LINE).toContain("when they hold Control+Command and ask");
  });
});
