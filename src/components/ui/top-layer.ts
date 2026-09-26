/**
 * Pop-ups above everything (owner decision, 26 September 2026). A calendar, time or length picker, a menu or a
 * tooltip opened from inside a modal sheet used to land behind the sheet's backdrop, or be clipped by its scroll
 * box. Marking the pop-up as a browser popover and showing it puts it in the top layer with the sheet, above any
 * clipping. Use as a ref callback on the pop-up's root, together with the `top-pop` class that resets the browser's
 * own popover box (globals.css). Older browsers without popovers keep the old behaviour.
 */
/**
 * Where a portaled pop-up should be mounted: inside the open modal sheet when its trigger is in one (everything
 * outside a modal sheet is inert, so a pop-up mounted on the body could be seen but not clicked), else the body.
 */
export function popoverHost(from: Element | null | undefined): HTMLElement {
  return (from?.closest("dialog[open]") as HTMLElement | null) ?? document.body;
}

export function liftToTopLayer(node: HTMLElement | null) {
  if (!node || typeof (node as HTMLElement & { showPopover?: () => void }).showPopover !== "function") return;
  try {
    if (!node.hasAttribute("popover")) node.setAttribute("popover", "manual");
    if (!node.matches(":popover-open")) node.showPopover();
  } catch { /* already shown, or not connected yet */ }
}
