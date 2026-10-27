//! Question or instruction (owner brief, 12 October 2026: "one Brenda, three lanes"; helpers-spec B.3).
//!
//! `is_instruction` is a port of `isInstruction` in `src/lib/act.ts`, word for word, with the front desk's verbs added
//! on both sides (hide, minimise, switch, mute, empty, take, capture, screenshot, paste, tile, raise, lower, pause …).
//! It reads only the person's own words (Rust's transcript of a hold, or words typed with a real press), never the
//! screen. A question goes straight to a look (or plain chat without pictures); an instruction that the on-Mac matcher
//! did not recognise goes to Boredroom's router. Pure; the shared vectors are `tests::vectors` here and
//! `tests/unit/act-grammar.test.ts` on the server: change both.

/// Verbs of doing something on a Mac or with a file (their stems: "summarised", "renaming" and "renames" match too).
pub const ACTION_VERBS: &[&str] = &[
    "rename", "move", "copy", "duplicate", "delete", "remove", "trash", "organise", "organize", "sort", "tidy", "clean", "arrange", "group", "file", "archive",
    "make", "create", "write", "draft", "compose", "rewrite", "redraft", "shorten", "expand", "edit", "fix", "correct", "proofread", "format", "reformat",
    "summarise", "summarize", "translate", "convert", "turn", "transcribe", "extract", "pull", "list", "compile", "collect", "gather", "combine", "merge", "split",
    "save", "export", "import", "print", "fill", "type", "enter", "click", "press", "tap", "select", "drag", "drop", "scroll", "open", "close", "quit",
    "send", "reply", "forward", "email", "message", "post", "publish", "share", "upload", "download", "attach", "submit", "book", "schedule", "add", "put",
    "insert", "replace", "change", "update", "set", "mark", "tag", "label", "highlight", "bold", "underline", "number", "resize", "crop", "rotate", "compress",
    "zip", "unzip", "prepare", "generate", "produce", "build", "do", "handle", "finish", "complete", "finalise", "finalize", "redo", "undo", "go", "navigate",
    "search", "find", "bookmark", "download", "reorder", "rearrange", "check", "tick", "untick", "uncheck", "pay", "buy", "order", "sign", "accept", "approve",
    // Phase 3 (owner request, 12 October 2026: "Brenda is meant to assist you do anything you need it to do").
    "help", "assist", "launch", "start", "show", "play", "read", "review", "remind", "get", "fetch", "grab", "bring", "load",
    // Brenda and her helpers (owner brief, 12 October 2026; helpers-spec B.3): the front desk's verbs, on both sides.
    "hide", "unhide", "minimise", "minimize", "maximise", "maximize", "switch", "mute", "unmute", "empty", "take", "capture", "screenshot", "paste",
    "tile", "raise", "lower", "increase", "decrease", "pause", "resume", "skip",
    // Review, 16 October 2026: "volume down a bit" missed the matcher and read as a question; now it goes to the router.
    "volume",
];

/// Two-word verbs of doing ("look through my documents", "look over this folder").
const ACTION_PAIRS: &[(&str, &str)] = &[("look", "through"), ("look", "over"), ("sort", "through")];

/// Phrases that ask someone to do something ("can you", "I need you to", "please").
const REQUEST_MARKERS: &[&str] = &[
    "can you", "could you", "would you", "will you", "can u", "please", "i need you", "i want you", "id like you", "i would like you", "i'd like you",
    "help me", "lets", "let's", "go ahead and", "make sure", "i need", "i want", "id like", "i would like", "for me",
];

/// Words a question starts with; "do" only before a person ("do you know…").
const QUESTION_START: &[&str] = &[
    "what", "whats", "why", "how", "who", "whos", "where", "wheres", "when", "which", "whose", "is", "isnt", "are", "arent", "was", "were", "does", "doesnt", "did",
    "didnt", "am", "has", "hasnt", "have", "havent", "should", "shall",
];
const PEOPLE: &[&str] = &["you", "u", "i", "we", "they", "it", "he", "she"];
/// Set aside before reading: fillers and openers that carry no meaning of their own.
const OPENERS: &[&str] = &["brenda", "hey", "ok", "okay", "so", "now", "just", "um", "uh", "er", "erm", "hmm", "well", "oh", "right", "alright", "and", "then"];

/// The words as `isInstruction` reads them: NFKC (the folding `yes.rs` does), lower case, curly apostrophes straight,
/// everything outside a–z, 0–9, the apostrophe and the space taken out.
fn words_of(text: &str) -> Vec<String> {
    let folded = crate::yes::fold(text);
    let cleaned: String = folded.chars().map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '\'' || c == ' ' { c } else { ' ' }).collect();
    cleaned.split_whitespace().map(String::from).collect()
}

/// `yesTokens` (act.ts): the same words, with "don't" and "that's" spelt without their apostrophe.
fn yes_tokens(text: &str) -> Vec<String> {
    words_of(text)
        .into_iter()
        .map(|t| match t.as_str() {
            "don't" => "dont".to_string(),
            "that's" => "thats".to_string(),
            _ => t,
        })
        .collect()
}

fn starts_with(tokens: &[String], at: usize, phrase: &[String]) -> bool {
    !phrase.is_empty() && at + phrase.len() <= tokens.len() && tokens[at..at + phrase.len()] == phrase[..]
}

fn pair_at(t: &[String], i: usize) -> bool {
    ACTION_PAIRS.iter().any(|(a, b)| t.get(i).is_some_and(|w| w == a) && t.get(i + 1).is_some_and(|w| w == b))
}

/// A word ends consonant, vowel, then one of b d g l m n p r t ("stop" → "stopped", "drop" → "dropping").
fn doubles(v: &str) -> bool {
    let c: Vec<char> = v.chars().collect();
    let n = c.len();
    if n < 3 {
        return false;
    }
    let vowel = |x: char| "aeiou".contains(x);
    !vowel(c[n - 3]) && vowel(c[n - 2]) && "bdglmnprt".contains(c[n - 1])
}

/// Whether a word is a verb of doing in one of its forms ("renames", "renamed", "renaming", "dropped").
fn verb_stem_at(word: &str) -> bool {
    let w = word.replace('\'', "");
    ACTION_VERBS.iter().any(|v| {
        let v = *v;
        w == v
            || w == format!("{v}s")
            || w == format!("{v}d")
            || w == format!("{v}ed")
            || w == format!("{v}ing")
            || (v.ends_with('e') && (w == format!("{}ing", &v[..v.len() - 1]) || w == format!("{v}d")))
            || (doubles(v) && {
                let last = &v[v.len() - 1..];
                w == format!("{v}{last}ed") || w == format!("{v}{last}ing")
            })
    })
}

/// Whether the person's own words ask her to DO something: an imperative ("Hide everything", "Brenda, summarise this
/// PDF"), or a request form ("can you…", "I need you to…", "please…"), with a verb of doing. A plain question ("What does
/// this error mean?", "How do I export in Figma?", "Is Figma open?") is not one. Deterministic.
pub fn is_instruction(text: &str, assistant_name: &str) -> bool {
    let folded = crate::yes::fold(text);
    let t = meaning_words(text, assistant_name);
    let joined = format!(" {} ", t.join(" "));
    // "Slack and Figma side by side" asks for windows to be arranged, verb or not (review, 16 October 2026).
    let side_by_side = joined.contains(" side by side ");
    if t.is_empty() || !(t.iter().any(|w| verb_stem_at(w)) || (0..t.len()).any(|i| pair_at(&t, i)) || side_by_side) {
        return false;
    }
    let asks = REQUEST_MARKERS.iter().any(|m| joined.contains(&format!(" {m} ")));
    // A question ("what…", "is…", "do you…") is an instruction only in a request form.
    if starts_as_question(&t) {
        return false;
    }
    if asks {
        return true;
    }
    // A question mark with no request form: a question.
    if folded.contains('?') || folded.contains('？') {
        return false;
    }
    // An imperative: one of the first three words is a verb of doing ("hide everything", "right, rename these").
    side_by_side || t.iter().take(3).enumerate().any(|(i, w)| ACTION_VERBS.contains(&w.replace('\'', "").as_str()) || pair_at(&t, i))
}

/// The words starting with a question word ("what…", "is…") or "do you…".
fn starts_as_question(t: &[String]) -> bool {
    t.first().is_some_and(|w| QUESTION_START.contains(&w.as_str())) || (t.first().is_some_and(|w| w == "do") && t.get(1).is_some_and(|w| PEOPLE.contains(&w.as_str())))
}

/// Whether the front desk's words are plainly a question (owner report, 27 October 2026): nothing at all once her name
/// and the fillers are set aside, or a question word first ("what…", "how…", "is…", "do you…"). Only these skip the
/// router and go straight to a look (or plain chat without pictures). Everything else the person says with her keys or
/// types in her notch reaches the router, even when `is_instruction` misses its verb ("clear my desktop", "tell Ada I'm
/// late", "Wi-Fi off", a transcript that ends "Open Figma?"): before, those went to a look or the chat, which can't do
/// things on the Mac and told the person to hold the keys and say it again, and saying it again came back to the same
/// place, every time.
pub fn is_plain_question(text: &str, assistant_name: &str) -> bool {
    // "what's" and "how's" read as "whats" and "hows" here (`is_instruction` keeps the server's port exactly).
    let t: Vec<String> = meaning_words(text, assistant_name).into_iter().map(|w| w.replace('\'', "")).collect();
    t.is_empty() || starts_as_question(&t) || t.first().is_some_and(|w| ["hows", "whys", "whens"].contains(&w.as_str()))
}

/// The person's words with her name and the openers before them set aside.
fn meaning_words(text: &str, assistant_name: &str) -> Vec<String> {
    let all = words_of(text);
    let name = yes_tokens(assistant_name);
    let mut t: Vec<String> = Vec::with_capacity(all.len());
    let mut i = 0;
    while i < all.len() {
        if !name.is_empty() && starts_with(&all, i, &name) {
            i += name.len();
            continue;
        }
        if t.is_empty() && OPENERS.contains(&all[i].as_str()) {
            i += 1;
            continue;
        }
        if all[i] == "brenda" {
            i += 1;
            continue;
        }
        t.push(all[i].clone());
        i += 1;
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shared vectors (helpers-spec B.3): today's lists in `act-grammar.test.ts` and `act-plan.test.ts`, plus the
    /// brief's everyday requests.
    #[test]
    fn vectors() {
        let instructions = [
            // act-grammar.test.ts (permission rule a)
            "Rename these files to Invoice-01 to Invoice-06",
            "Brenda, I need you to summarise this PDF",
            "Can you summarise this PDF?",
            "Please tidy this spreadsheet",
            "Could you check this spreadsheet for errors?",
            "Max, make a one-page brief of this report",
            "I need you to rename these files",
            "help me fill in this form",
            "Turn this into a Word document",
            "let's move these into the Invoices folder",
            "I'd like you to draft a reply to this email",
            "Alright, rename these",
            "ZEBRA-7731 rename these files to invoices",
            // act-plan.test.ts (phase 3)
            "open up",
            "Open Figma",
            "can you open Figma for me",
            "help me with this spreadsheet",
            "remind me at 3 to review it",
            "look through my documents and summarise them",
            "find the invoice from last week and open it",
            "summarise everything in this folder",
            "bring up my Downloads",
            // helpers-spec B.3 (the brief's table)
            "Hide everything",
            "Take a screenshot of this",
            "Empty the Trash",
            "Turn the volume down",
            "Organise my desktop",
            "Rename these photos by date",
            "Convert this to PDF",
            "Summarise this folder",
            "Find last week's invoice and open it",
            "Delete my old screenshots",
            "Fill in this form",
            "Buy more iCloud storage",
            "Message Ada that I'm done",
            "Add this to my to-dos for Friday",
            "Remind me at 3 to call Ada",
            "Show me where the export button is",
            "Mute",
            "Minimise Figma",
            "Switch to Slack",
            "Pause the music",
            "Capture my screen",
            "Unmute",
            "Maximise Safari",
            // Review, 16 October 2026: what the matcher misses still goes to the router, not to a look.
            "Volume down a bit",
            "Slack and Figma side by side",
            "Put Slack and Figma side-by-side.",
        ];
        for s in instructions {
            assert!(is_instruction(s, "Max"), "an instruction: {s:?}");
        }
        let questions = [
            "What does this email say?",
            "What is this, and why is it red?",
            "How do I export this?",
            "Why won't this button work?",
            "Can you tell me what this is?",
            "Is this file a PDF?",
            "Who sent this?",
            "",
            "hmm",
            "Brenda",
            "Do you know what this is?",
            "Rename these files?",
            "I renamed these yesterday",
            "what does it say",
            "how do I turn on the features so that I can be able to look through my documents and summarise them and maybe open up",
            "what does this say?",
            "is Figma open?",
            "What does this error mean?",
            "How do I export in Figma?",
            "What's on my plate today?",
            "Is Figma open?",
            "What's the volume?",
            "Are Slack and Figma side by side?",
        ];
        for s in questions {
            assert!(!is_instruction(s, "Max"), "a question: {s:?}");
        }
    }

    #[test]
    fn verb_forms() {
        assert!(verb_stem_at("renaming") && verb_stem_at("renamed") && verb_stem_at("renames"));
        assert!(verb_stem_at("dropped") && verb_stem_at("dropping") && verb_stem_at("summarised"));
        assert!(!verb_stem_at("yesterday"));
        assert!(doubles("stop") && !doubles("rename") && !doubles("go"));
    }

    /// Owner report, 27 October 2026: things said with her keys that `is_instruction` misses still reach the router, so
    /// she never answers "hold the keys and say it again" to words she will read the same way the second time.
    #[test]
    fn what_reaches_the_router() {
        let missed_but_routed = [
            "Clear my desktop",
            "Tell Ada I'm running late",
            "Wi-Fi off",
            "Open Figma?",
            "Brenda, Spotify next song",
            "I want to see my Downloads",
            "Lock my screen",
            "Can you tell Ada the deck is ready?",
        ];
        for s in missed_but_routed {
            assert!(!is_plain_question(s, "Max"), "goes to the router: {s:?}");
        }
        // The loop needed both: not an instruction by the verb list, so before it never reached the router.
        assert!(!is_instruction("Clear my desktop", "Max") && !is_instruction("Open Figma?", "Max"));
        let questions = ["What does this error mean?", "How do I export in Figma?", "Is Figma open?", "Do you know what this is?", "what's on my plate today", "", "hmm", "Max", "Brenda, why is this red?"];
        for s in questions {
            assert!(is_plain_question(s, "Max"), "a plain question: {s:?}");
        }
        // Every instruction is routed (never a plain question).
        for s in ["Open Figma", "Can you summarise this PDF?", "Hide everything", "Max, hide Slack"] {
            assert!(is_instruction(s, "Max") && !is_plain_question(s, "Max"), "{s:?}");
        }
    }

    #[test]
    fn her_name_and_curly_apostrophes() {
        assert!(is_instruction("Max, hide Slack", "Max"));
        assert!(is_instruction("Max Power, hide Slack", "Max Power"));
        assert!(is_instruction("I\u{2019}d like you to tidy my desktop", "Max"));
        assert!(!is_instruction("Max", "Max"));
    }
}
