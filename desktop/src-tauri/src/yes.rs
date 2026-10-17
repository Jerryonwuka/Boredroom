//! The yes grammar (owner rule, 12 October 2026: "Brenda cannot take any action except I explicitly give an instruction
//! … if it's a core task, Brenda should confirm, do you want me to do this? And then I'll say, yes").
//!
//! A task starts only on an explicit yes to that exact proposal. Spoken words (Rust's own transcript of a hold of her
//! keys or Option+Space) and typed words (with a real press) are read here; anything that is not clearly yes is no.
//! The same grammar, with the same test vectors, is `verdict` in `src/lib/act.ts`, and the server checks the words again
//! (companion-spec 0.5): change both together.
//!
//! Pure: no system calls, no state.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Yes,
    No,
    Unclear,
}

const YES_WORD: &[&str] = &["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "alright", "correct", "absolutely", "definitely", "certainly"];
const TAIL: &[&str] = &[
    "do it",
    "do that",
    "do this",
    "go ahead",
    "go for it",
    "go on",
    "carry on",
    "continue",
    "proceed",
    "please do",
    "please do it",
    "i need you to do this",
    "i need you to do that",
    "i need you to do it",
    "i want you to do this",
    "i want you to do that",
    "i want you to do it",
    "thats right",
    "thats fine",
    // Review, 12 October 2026: everyday yeses that were refused.
    "go",
    "you can do it",
    "you can do that",
    "you can do this",
    "you can go ahead",
    "you can",
];
const THANKS: &[&str] = &["please", "thanks", "thank you"];
/// "now" may close a yes ("yes, do it now"), before any thanks.
const NOW: &[&str] = &["now", "right now"];
const NO_FIRST: &[&str] = &["no", "nope", "nah", "dont", "stop", "cancel", "never"];
const NO_PHRASES: &[&str] = &["not now", "never mind", "leave it", "no thanks", "no thank you", "not yet", "dont do it", "dont"];
const BLOCK: &[&str] = &[
    "no", "nope", "nah", "not", "dont", "never", "stop", "wait", "cancel", "hold", "hang", "but", "except", "instead", "actually", "only", "first", "before",
    "after", "rather", "change", "different", "wrong", "maybe", "later", "if", "unless", "or", "why", "what", "how", "which", "who", "where", "when",
];
/// "and" is allowed only between two TAIL phrases ("go ahead and do it"); anywhere else the grammar fails, so "yes and also
/// rename the folder" stays unclear (review, 12 October 2026: "and" left BLOCK for that one place).
const AND: &str = "and";
const FILLERS: &[&str] = &["um", "uh", "er", "erm", "hmm", "so", "well", "oh"];
const LEADING: &[&str] = &["brenda", "hey"];
/// More tokens than this is never a clear yes.
const MAX_TOKENS: usize = 10;
/// A no or unclear answer with at least this many words (after a leading no) is a new request (0.5).
const NEW_REQUEST_TOKENS: usize = 4;

/// The compatibility folding NFKC does for the characters that matter here (no normalisation crate is available
/// offline, 12 October 2026): full-width ASCII, the ideographic and no-break spaces, the f-ligatures, curly quotes and
/// apostrophes, the full-width question mark. Anything else outside a–z, 0–9 and the apostrophe becomes a space in
/// step 3 anyway.
pub(crate) fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\u{FF01}'..='\u{FF5E}' => out.push(char::from_u32(c as u32 - 0xFF01 + 0x21).unwrap_or(' ')),
            '\u{3000}' | '\u{00A0}' | '\u{2007}' | '\u{202F}' => out.push(' '),
            '\u{FB00}' => out.push_str("ff"),
            '\u{FB01}' => out.push_str("fi"),
            '\u{FB02}' => out.push_str("fl"),
            '\u{FB03}' => out.push_str("ffi"),
            '\u{FB04}' => out.push_str("ffl"),
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' | '\u{2032}' | '\u{02BC}' => out.push('\''),
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' | '\u{2033}' => out.push('"'),
            '\u{FE56}' => out.push('?'),
            _ => out.extend(c.to_lowercase()),
        }
    }
    out.to_lowercase()
}

/// Steps 3 and 5's spelling: only a–z, 0–9 and the apostrophe survive; apostrophes are then taken out of each word
/// ("don't" → "dont", "that's" → "thats").
fn words(s: &str) -> Vec<String> {
    let cleaned: String = s.chars().map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '\'' { c } else { ' ' }).collect();
    cleaned.split_whitespace().map(|w| w.replace('\'', "")).filter(|w| !w.is_empty()).collect()
}

/// Steps 1, 3, 4 and 5: the answer's words, the assistant's name and "brenda"/"hey" taken out wherever they stand (a
/// form of address: "Yes, Brenda", "Do it, Brenda"; review, 12 October 2026, it was only taken off the front), fillers off
/// both ends. The second value says whether a question mark was seen (step 2).
fn tokens(text: &str, assistant_name: &str) -> (Vec<String>, bool) {
    let s = fold(text);
    let question = s.contains('?');
    let t = words(&s);
    let name = words(&fold(assistant_name));
    // Step 4: the whole name (all its words, in order), "brenda" and "hey", anywhere.
    let mut out: Vec<String> = Vec::with_capacity(t.len());
    let mut i = 0;
    while i < t.len() {
        if !name.is_empty() && i + name.len() <= t.len() && t[i..i + name.len()] == name[..] {
            i += name.len();
            continue;
        }
        if LEADING.contains(&t[i].as_str()) {
            i += 1;
            continue;
        }
        out.push(t[i].clone());
        i += 1;
    }
    let mut t = out;
    // Step 5: fillers at both ends.
    while t.first().is_some_and(|w| FILLERS.contains(&w.as_str())) {
        t.remove(0);
    }
    while t.last().is_some_and(|w| FILLERS.contains(&w.as_str())) {
        t.pop();
    }
    (t, question)
}

/// The end of `phrase` if it starts at `i`.
fn phrase_at(t: &[String], i: usize, phrase: &str) -> Option<usize> {
    let p: Vec<&str> = phrase.split(' ').collect();
    (i + p.len() <= t.len() && t[i..i + p.len()].iter().zip(&p).all(|(a, b)| a == b)).then_some(i + p.len())
}

/// Every position reachable after one of `phrases` (or staying put when `optional`).
fn after_any(t: &[String], from: &[usize], phrases: &[&str], optional: bool) -> Vec<usize> {
    let mut out: Vec<usize> = if optional { from.to_vec() } else { Vec::new() };
    for &i in from {
        for p in phrases {
            if let Some(j) = phrase_at(t, i, p) {
                out.push(j);
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// One or two TAIL phrases, with "and" allowed only between them ("go ahead and do it", "that's fine, do it").
fn after_tails(t: &[String], from: &[usize], optional: bool) -> Vec<usize> {
    let one = after_any(t, from, TAIL, false);
    let joined = after_any(t, &one, &[AND], true);
    let two = after_any(t, &joined, TAIL, false);
    let mut out: Vec<usize> = if optional { from.to_vec() } else { Vec::new() };
    out.extend(one);
    out.extend(two);
    out.sort_unstable();
    out.dedup();
    out
}

/// Step 9: `YES_WORD+ ["please"] [TAIL [["and"] TAIL]] ["now"] [THANKS]` or `["please"] TAIL [["and"] TAIL] ["now"]
/// [THANKS]`, the whole answer.
fn is_yes(t: &[String]) -> bool {
    let n = t.len();
    // YES_WORD+
    let mut yes_end = 0;
    while yes_end < n && YES_WORD.contains(&t[yes_end].as_str()) {
        yes_end += 1;
    }
    let mut starts: Vec<usize> = (1..=yes_end).collect();
    if !starts.is_empty() {
        let s = after_any(t, &starts, &["please"], true);
        let s = after_tails(t, &s, true);
        let s = after_any(t, &s, NOW, true);
        let s = after_any(t, &s, THANKS, true);
        if s.contains(&n) {
            return true;
        }
    }
    starts = after_any(t, &[0], &["please"], true);
    let s = after_tails(t, &starts, false);
    let s = after_any(t, &s, NOW, true);
    let s = after_any(t, &s, THANKS, true);
    s.contains(&n)
}

/// The verdict on an answer to "Do you want me to do this?" (0.5). Unclear is treated as no by every caller.
pub fn verdict(text: &str, assistant_name: &str) -> Verdict {
    let (t, question) = tokens(text, assistant_name);
    if question {
        return Verdict::Unclear;
    }
    if t.is_empty() || t.len() > MAX_TOKENS {
        return Verdict::Unclear;
    }
    let whole = t.join(" ");
    if NO_PHRASES.contains(&whole.as_str()) || NO_FIRST.contains(&t[0].as_str()) {
        return Verdict::No;
    }
    if t.iter().any(|w| BLOCK.contains(&w.as_str())) {
        return Verdict::Unclear;
    }
    if is_yes(&t) {
        Verdict::Yes
    } else {
        Verdict::Unclear
    }
}

/// Whether an unclear answer is really a new request (0.5): four or more words that change what was asked ("yes but
/// only the first three" becomes a new proposal, which needs its own yes). Review, 12 October 2026:
/// - an answer that starts with a no ("no thanks, I'll do it myself later") is a no and nothing else: nothing happens,
///   no new look is sent;
/// - an answer that starts with a yes word and holds no BLOCK word ("yes, go ahead and do it now please") is never a new
///   request: it is a yes the grammar missed, and the person hears "I didn't catch a clear yes".
pub fn is_new_request(text: &str, assistant_name: &str) -> bool {
    let (t, _) = tokens(text, assistant_name);
    let Some(first) = t.first() else { return false };
    if NO_FIRST.contains(&first.as_str()) || NO_PHRASES.iter().any(|p| phrase_at(&t, 0, p).is_some()) {
        return false;
    }
    if YES_WORD.contains(&first.as_str()) && !t.iter().any(|w| BLOCK.contains(&w.as_str())) {
        return false;
    }
    t.len() >= NEW_REQUEST_TOKENS
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every row of companion-spec 0.5 (the same vectors as `src/lib/act.ts`).
    #[test]
    fn vectors() {
        let yes = [
            "yes",
            "Yes.",
            "yeah",
            "yep",
            "sure",
            "ok",
            "okay",
            "Yes please",
            "yes, do it",
            "Yes, I need you to do this.",
            "go ahead",
            "Do it",
            "please do",
            "Brenda, yes",
            "Max, yes go ahead",
            "yes yes",
            "OK, go ahead",
            "alright do it",
            "correct",
            "yes please go ahead",
            "yeah go for it",
            "yes thank you",
            // Review, 12 October 2026: everyday yeses, the name as a form of address anywhere.
            "Yes, Brenda.",
            "Yes please Brenda",
            "Do it, Brenda.",
            "Yes, thanks Brenda.",
            "Yes, I need you to do this, Brenda.",
            "Yes, do it now.",
            "Yeah, go.",
            "Yes, go ahead and do it.",
            "Yeah, that's fine, do it.",
            "Yes, you can do it.",
            "Max, yes go ahead Max",
        ];
        for s in yes {
            assert_eq!(verdict(s, "Max"), Verdict::Yes, "{s:?}");
        }
        let no = ["no", "No.", "nope", "no thanks", "not now", "don't", "stop", "cancel", "never mind", "no, don't do that"];
        for s in no {
            assert_eq!(verdict(s, "Max"), Verdict::No, "{s:?}");
        }
        let unclear = [
            "",
            "hmm",
            "yes?",
            "yes but only the first three",
            "yes, wait",
            "maybe",
            "do it later",
            "yes and also rename the folder",
            "what will you do?",
            "sure, if it's quick",
            "yes no",
            "yeah actually rename them to receipts",
            "okay but not the PDFs",
            "I think so",
            "sounds good",
            "yes I need you to rename them",
            "and do it",
            "yes and",
            "go ahead and",
            "do it and also rename the folder",
        ];
        for s in unclear {
            assert_eq!(verdict(s, "Max"), Verdict::Unclear, "{s:?}");
        }
    }

    #[test]
    fn curly_apostrophes_full_width_and_names() {
        assert_eq!(verdict("Don\u{2019}t", "Brenda"), Verdict::No);
        assert_eq!(verdict("\u{FF59}\u{FF45}\u{FF53}", "Brenda"), Verdict::Yes, "full-width yes");
        assert_eq!(verdict("yes\u{FF1F}", "Brenda"), Verdict::Unclear, "full-width question mark");
        assert_eq!(verdict("Hey Mary Jane, yes", "Mary Jane"), Verdict::Yes);
        assert_eq!(verdict("Max yes", "Brenda"), Verdict::Unclear, "another name is not dropped");
        assert_eq!(verdict("um, yes please", "Brenda"), Verdict::Yes, "fillers at the front");
        assert_eq!(verdict("yes thanks", "Brenda"), Verdict::Yes);
        assert_eq!(verdict("thats fine", "Brenda"), Verdict::Yes);
        assert_eq!(verdict("yes yes yes yes yes yes yes yes yes yes yes", "Brenda"), Verdict::Unclear, "more than 10 words");
    }

    #[test]
    fn long_unclear_answers_become_new_requests() {
        assert!(is_new_request("yes but only the first three", "Brenda"));
        assert!(is_new_request("yeah actually rename them to receipts", "Brenda"));
        assert!(is_new_request("rename them to receipts instead please", "Brenda"));
        assert!(!is_new_request("not now thanks", "Brenda"));
        assert!(!is_new_request("yes, wait", "Brenda"));
        assert!(!is_new_request("maybe", "Brenda"));
    }

    /// Review, 12 October 2026: a no is a no (nothing happens, no new look); a yes the grammar missed is not a request.
    #[test]
    fn a_no_is_never_a_new_request() {
        for s in [
            "no, rename them to receipts instead",
            "No thanks, I'll do it myself later",
            "Cancel that, I changed my mind completely",
            "no thank you just rename the first two",
            "never mind, I will sort it out tomorrow",
            "don't, I'll handle the files myself",
            "Brenda, stop, I want to do it by hand",
        ] {
            assert!(!is_new_request(s, "Brenda"), "{s:?}");
            assert_eq!(verdict(s, "Brenda"), Verdict::No, "{s:?}");
        }
        for s in ["yes go ahead and do it right now please thanks", "yeah do it do it do it now"] {
            assert!(!is_new_request(s, "Brenda"), "{s:?}");
        }
    }
}
