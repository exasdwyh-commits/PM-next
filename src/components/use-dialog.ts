"use client";

import { useEffect, useRef, type RefObject } from "react";

const dialogs: HTMLElement[] = [];
let originalOverflow = "";

function orderLayers() {
  dialogs.forEach((dialog, index) => {
    const surface = dialog.closest<HTMLElement>("[data-dialog-layer]") ?? dialog;
    const sibling = dialog.previousElementSibling;
    const scrim = sibling instanceof HTMLElement && sibling.hasAttribute("data-dialog-scrim") ? sibling : null;
    surface.style.zIndex = String(80 + index * 2 + (scrim ? 1 : 0));
    if (scrim) scrim.style.zIndex = String(80 + index * 2);
  });
}

/** Shared keyboard and scroll behavior, including dialogs opened above another dialog. */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  open = true
) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement;
    if (dialogs.length === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogs.push(dialog);
    orderLayers();
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const input = controls().find(element => element.matches("input, textarea, select"));
    (input ?? controls()[0] ?? dialog).focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog || event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      const wasTop = dialogs.at(-1) === dialog;
      const index = dialogs.indexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      orderLayers();
      if (dialogs.length === 0) document.body.style.overflow = originalOverflow;
      if (wasTop && trigger instanceof HTMLElement && trigger.isConnected &&
          (dialogs.length === 0 || dialogs.at(-1)?.contains(trigger))) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}
