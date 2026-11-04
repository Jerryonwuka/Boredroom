# Brenda for Chrome

The Chrome half of "Brenda in Chrome". It lets Brenda work in her own tabs in one Chrome profile while the Brenda Mac app is running. The wire contract with the Mac app is [PROTOCOL.md](PROTOCOL.md).

## Install (private, unpacked)

1. Open `chrome://extensions` in the Chrome profile Brenda should use.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `browser-extension` folder. Brenda for Mac ships a copy inside the app, and her **Connect Chrome** button shows it in Finder and opens this page for you.

The extension ID is fixed by the `key` in `manifest.json`: **`mfchmhbapfbmbcggleegknbfbddikhcf`** (also in `EXTENSION_ID`).

The Mac app writes the native messaging host manifest (`com.boredroom.browser`, allowing only that extension ID) into Chrome's `NativeMessagingHosts` folder. The extension connects to it on start and retries every 5 seconds; nothing happens until the Mac app is running.

## What it will and won't do

- It only talks to the Brenda Mac app on this computer. It has no access to any website by itself and never talks to Boredroom's servers.
- Brenda works only in tabs she opened, kept in an orange tab group called "Brenda". She never reads or touches your other tabs.
- When you switch to one of her tabs, she stops acting in it (she can still look) until you switch away.
- She never types into password, card, bank, PIN or one-time-code fields, and never reads their values.
- She only opens ordinary `http`/`https` pages, never addresses with a password in them, and stops any page of hers that tries to go somewhere else.
- Before anything that could pay, send, delete, sign in, accept terms, submit a form or download, the Mac app asks you first.
- Chrome shows a "Brenda for Chrome started debugging this browser" bar while she works. Pressing **Cancel** on it stops her control until the app reconnects.
- Closing the Mac app (or the connection) releases her tabs and leaves them open.

## Tests

- `npx vitest run tests/unit/browser-extension.test.ts` covers the pure logic in `lib/`.
- `pnpm check:browser-extension` runs the real extension end to end in a throwaway headless Chromium (its own profile), through the Mac app's real relay (`cargo build` in `desktop/src-tauri` first), against local pages: every operation and every refusal. Set `CHROMIUM_PATH` when Playwright's own Chromium build isn't installed. It never touches your own Chrome or a running Brenda.
