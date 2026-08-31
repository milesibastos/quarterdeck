"use client";

import * as React from "react";
import type { GrokMenuItem } from "@/ui/components/grok/grok-header";
import {
  GrokShortcuts,
  type GrokShortcutGroup,
} from "@/ui/components/grok/grok-shortcuts";

/**
 * The keyboard help, and the three keys it is about.
 *
 * ## Why the list is this short
 *
 * A shortcuts panel is a claim about what the page does, and a claim is only
 * worth drawing if it is true. The panel reads; it has almost nothing to drive.
 * So this names exactly the bindings that exist and the one thing the browser
 * does for free, rather than filling the modal out to look substantial - a help
 * screen listing a key that does nothing is worse than no help screen, because
 * it is the one surface an operator is entitled to trust completely.
 *
 * The same list feeds the masthead's legend rows, so the two cannot disagree
 * about what the panel answers to.
 *
 * ## Why the modal is inline rather than floating
 *
 * `GrokShortcuts` is a `role="dialog"`, and grok draws it over the session. A
 * floating overlay needs a stacking context, a backdrop, a focus trap and a
 * position that survives a 360-pixel viewport; an inline disclosure needs none
 * of those and is correct at every width. It is a non-modal dialog: the page
 * behind it stays usable, which for a panel whose whole job is to be read is
 * the better trade anyway.
 */

/** Where focus goes when the operator asks for the fleet chooser. */
const CURRENT_FLEET_CHOICE = '[data-fleet-choice][aria-current="true"]';

export const FRAME_SHORTCUTS: GrokShortcutGroup[] = [
  {
    id: "panel",
    label: "Panel",
    items: [
      { action: "Keyboard shortcuts", keys: "?" },
      { action: "Close this", keys: "Esc" },
      { action: "Go to the fleet chooser", keys: "f" },
    ],
  },
  {
    id: "reading",
    label: "Reading the page",
    items: [
      { action: "Next control", keys: "Tab" },
      { action: "Previous control", keys: "Shift+Tab" },
      { action: "Choose a fleet, once the chooser has focus", keys: "↑ / ↓" },
    ],
  },
];

/** The same three keys, as the masthead's legend. No handlers: the keys are. */
export const FRAME_MENU: GrokMenuItem[] = FRAME_SHORTCUTS[0].items.map(
  ({ action, keys }) => ({ label: action, key: keys }),
);

/**
 * True when a keystroke belongs to whatever the operator is typing into.
 *
 * A bare letter binding on a page with a text field is a bug waiting for the
 * first person who types an `f`. The answer control and the merge card both
 * carry inputs, so this guard is not hypothetical.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function KeyboardHelp() {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A shortcut with a modifier is the browser's or the operating
      // system's, never this page's.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        // Escape closes whatever is open wherever it is pressed, including
        // from inside a field - which is the one case the typing guard below
        // must not swallow.
        setOpen((wasOpen) => {
          if (wasOpen) trigger.current?.focus();
          return false;
        });
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      } else if (event.key === "f") {
        const choice = document.querySelector<HTMLElement>(CURRENT_FLEET_CHOICE);
        if (!choice) return;
        event.preventDefault();
        choice.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div data-keyboard-help className="min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="keyboard-help-panel"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="rounded-sm border border-term-rule-soft px-2 py-0.5 font-mono text-[12px] text-term-muted outline-none hover:bg-term-selected hover:text-term-fg focus-visible:ring-1 focus-visible:ring-ring"
      >
        [?] shortcuts
      </button>

      {open ? (
        <GrokShortcuts
          id="keyboard-help-panel"
          groups={FRAME_SHORTCUTS}
          defaultExpanded="panel"
          legend="Space/Enter expand · Esc close"
          search={null}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
          className="mt-2 w-full max-w-2xl"
        />
      ) : null}
    </div>
  );
}
