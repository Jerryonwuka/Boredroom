# Brenda in Chrome: the wire protocol (Phase 2)

Owner decisions, 4 November 2026: private install first (load unpacked), one Chrome profile, the Mac app must be running.

```
Boredroom server ──HTTPS── Brenda for Mac (Tauri, jobs.rs run_web)
                                │  Unix socket ~/Library/Application Support/com.boredroom.desktop/browser.sock (0600)
                                │  framing: u32 little-endian length + UTF-8 JSON (≤ 8 MB)
                          relay (the Mac app's own binary, started by Chrome with the extension origin as argv[1])
                                │  Chrome native messaging (stdin/stdout, same framing; host name com.boredroom.browser)
                          the extension (Manifest V3 service worker, chrome.debugger / CDP 1.3)
```

The extension opens the port with `chrome.runtime.connectNative("com.boredroom.browser")` when it starts, and again after a disconnect, with a 5 s backoff. It never talks to Boredroom's server and has no other network access.

## Messages

Every message is a JSON object with `"v": 1`.

**Hello (extension → app), first on every connection:**
```json
{ "v": 1, "hello": { "version": "0.1.0", "chrome": "131.0.6778.86", "profile": "jerry@example.com" } }
```
- `profile` is the Chrome profile's signed-in email from `chrome.identity.getProfileUserInfo({ accountStatus: "ANY" })`, or `""`. The app shows it so the person knows which profile Brenda uses.

**Request (app → extension):**
```json
{ "v": 1, "id": "17", "op": "read_page", "args": { "tab": "t1" } }
```

**Reply (extension → app), exactly one per request, same id:**
```json
{ "v": 1, "id": "17", "ok": true, "out": { } }
{ "v": 1, "id": "17", "ok": false, "error": "NO_TAB", "message": "That tab was closed." }
```

**Event (extension → app), unsolicited, never with an id:**
```json
{ "v": 1, "event": "tab_closed", "tab": "t1" }
{ "v": 1, "event": "user_here", "tab": "t1" }
```

## Tabs
- Brenda opens her own tabs only, in one tab group titled "Brenda" (orange), in the last focused window, with `active: false`.
- Tab ids on the wire are `t1`, `t2`, and so on, per connection. She never reads or acts in a tab she didn't open.
- **"The person is here":** when one of Brenda's tabs becomes the active tab of the focused window, every acting op on it (click, type, select, press, scroll, navigate) answers `USER_HERE` until it isn't active any more. read_page, screenshot and describe still work. The extension also sends the `user_here` event once each time this starts.
- **Closing:** a tab the person closes gives `tab_closed`. When the connection closes, the extension detaches the debugger from all her tabs and leaves them open.

## Refs
- `read_page` gives the interesting elements refs (`e1`, `e2`, and so on). These include links, buttons, inputs, selects, checkboxes, tabs, menu items and headings, plus any element that has an accessible name.
- Every `read_page` makes new refs and forgets the old ones for that tab. An op with a ref the latest read didn't give answers `STALE_REF`.

## Ops

| op | args | out |
| --- | --- | --- |
| `status` | — | `{ tabs: number }` |
| `open_tab` | `{ url }` | `{ tab, url, title }` once loaded (≤ 20 s; still answers after the time limit, with `loading: true`) |
| `navigate` | `{ tab, url }` | `{ url, title }` |
| `read_page` | `{ tab, find? }` | see below |
| `screenshot` | `{ tab }` | `{ jpeg: base64, width, height }`, quality 60, at most 1280 px wide, at most 1.5 MB |
| `describe` | `{ tab, ref, action? }` | `{ role, name, tag, inputType, inForm, sensitive, effect, host }` (`action`: `click`, `enter` or `select`; `click` when missing) |
| `click` | `{ tab, ref }` | `{ url, title, navigated }` |
| `type` | `{ tab, ref, text, enter }` | `{ url, title }` (`enter`: press Return after) |
| `select` | `{ tab, ref, option }` | `{ value }` (option by its visible text) |
| `press` | `{ tab, key }` | `{}` (key is one of: Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home, End, Backspace; `Enter` answers `BAD_REQUEST`, because Return only goes through `type` with `enter: true`) |
| `scroll` | `{ tab, dir }` | `{}` (dir: `up`, `down`, `top`, `bottom`) |
| `wait_for` | `{ tab, text?, ms }` | `{ found }` (ms ≤ 20000; polls the page's text every 250 ms) |
| `close_tab` | `{ tab }` | `{}` |

**`read_page` out:**
```json
{ "url": "https://…", "title": "…", "text": "the page's visible text, at most 20000 characters",
  "truncated": false,
  "elements": [ { "ref": "e1", "role": "button", "name": "Pay £42.00", "value": null, "inputType": null, "sensitive": false, "href": null } ] }
```
- At most 400 elements, in document order. `find` narrows them to those whose name or value contains its words, case-insensitively.
- `sensitive` is true for:
  - password fields
  - inputs whose `autocomplete` contains `cc-`, `one-time-code`, `current-password` or `new-password`
  - inputs whose name or id says card, cvv, cvc, iban, ssn or pin
- A sensitive element's `value` is always null.

**`describe.effect`** is the extension's best guess at what the `action` does to the element, from its role, name, type, form and attributes:
- `click`: clicking into a field (text input, textarea, search box, select, or any other editable or input element) is `none`. Buttons, submit/image/reset inputs, checkboxes, radios, links and menu items follow the table below, and a submit button keeps its form's effect.
- `enter`: Return in a field inside a form is that form's submit effect (search: `none`); a field outside a form, or a textarea, is `none`. Other elements follow the table.
- `select`: always `none` (choosing an option never submits by itself).

| effect | when |
| --- | --- |
| `pay` | buy, pay, purchase, checkout, place order, subscribe, donate, or a form with card fields |
| `send` | send, post, publish, reply, comment, share, tweet, message, invite |
| `delete` | delete, remove, discard, cancel subscription, close account, unsubscribe |
| `sign_in` | sign in, log in, continue with Google/Apple/Microsoft, or a form with a password field |
| `accept_terms` | accept, agree, I agree, consent, allow (cookie banners included) |
| `submit` | any other submit button, `type=submit`, or the default button of a form |
| `download` | a link with a `download` attribute, or one that ends in a file extension (pdf, zip, csv, xlsx, docx, dmg, pkg, exe) |
| `none` | everything else (plain links, tabs, menus, clicking into fields, choosing options), and submitting a search (see below) |

The match is on whole words, case-insensitive. Pressing Enter in a field inside a form (`action: "enter"`) counts as that form's submit.

**A search box is not a submit** (4 November 2026): when the element is a search input (input `type=search`, role `searchbox`, or a `combobox` inside `role=search`, or an input whose name, id, placeholder or aria-label is the whole word "search" or "q"), or its form is a search form (`role=search`, or the form's only text input is such a search input), then Enter or submit there is `none`. Card fields (`pay`), password fields (`sign_in`) and the words above still win.

## Refusals (the extension enforces these whatever the app sends)
- `type` into a sensitive element: `SENSITIVE`.
- A URL that isn't http(s), or that has a user or password in it: `BAD_URL`. Applies to `open_tab`, `navigate`, and any page Brenda's tab lands on, which is then stopped with `Page.stopLoading`.
- An op on a tab that isn't hers: `NO_TAB`.
- Every op has a time limit: 30 s at most, 20 s for loads. On expiry the answer is `TIMEOUT`.

## Error codes
`BAD_REQUEST`, `NO_TAB`, `STALE_REF`, `NOT_VISIBLE`, `SENSITIVE`, `BAD_URL`, `USER_HERE`, `TIMEOUT`, `DEBUGGER` (couldn't attach, for example because DevTools is open), `FAILED`.

## The app's own checks (Rust, jobs.rs / browser.rs)
- Before every click, type with `enter: true`, select or press Enter, the Mac calls `describe` with the matching `action` (`click`; `enter` for type with `enter: true`; `select`). When `effect` isn't `none`, or the server didn't mark that call as one it asked about, the call isn't run. The model hears "This would <effect>; call it again with effect set so the person is asked."
- Every `url` in a reply is checked against Look's never-look sites. On a match, the tab is closed and the job stops.
- Page text and screenshots are kept only in memory, only while the job runs.
