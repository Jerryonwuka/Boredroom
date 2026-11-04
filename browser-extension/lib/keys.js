// CDP Input.dispatchKeyEvent parameters for the keys the protocol allows.

const DEFS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  Backspace: { code: "Backspace", keyCode: 8 },
};

/** The down and up events for a key, or null for one that isn't allowed. */
export function keyEvents(key) {
  const def = Object.hasOwn(DEFS, key) ? DEFS[key] : null;
  if (!def) return null;
  const common = { key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode };
  // A key that produces text needs keyDown with text; the rest are rawKeyDown so no character is inserted.
  const down = def.text ? { type: "keyDown", ...common, text: def.text, unmodifiedText: def.text } : { type: "rawKeyDown", ...common };
  return [down, { type: "keyUp", ...common }];
}
