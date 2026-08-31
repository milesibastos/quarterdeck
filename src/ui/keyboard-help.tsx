"use client";

import * as React from "react";
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
 * The list is the one place these are written down: the bindings below read
 * from it, so the help cannot describe a key the page does not answer to.
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

/**
 * Where focus goes when the operator asks for the fleet chooser, and how to
 * get there when it is shut. The chooser is a disclosure - see
 * `src/ui/fleet-picker.tsx` for why - so `f` opens it first and lands in it
 * second; its own trigger is what does the focusing, so there is one answer to
 * "where does opening it put you" rather than two.
 */
const CURRENT_FLEET_CHOICE = '[data-fleet-choice][aria-current="true"]';
const FLEET_DISCLOSURE = "[data-fleet-open]";

export const FRAME_SHORTCUTS: GrokShortcutGroup[] = [
  {
    id: "panel",
    label: "Panel",
    items: [
      { action: "Keyboard shortcuts", keys: "?" },
      { action: "Close this", keys: "Esc" },
      { action: "Open the fleet chooser", keys: "f" },
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
        // must not swallow. Both disclosures, not just this one: the list
        // above says "Close this - Esc" and the fleet chooser is a this.
        setOpen((wasOpen) => {
          if (wasOpen) trigger.current?.focus();
          return false;
        });
        const chooser = document.querySelector<HTMLElement>(FLEET_DISCLOSURE);
        if (chooser?.getAttribute("aria-expanded") === "true") {
          chooser.click();
          // A programmatic click does not move focus, and the element the
          // operator was on is about to be hidden.
          chooser.focus();
        }
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      } else if (event.key === "f") {
        const chooser = document.querySelector<HTMLElement>(FLEET_DISCLOSURE);
        if (!chooser) return;
        event.preventDefault();
        if (chooser.getAttribute("aria-expanded") === "true") {
          document.querySelector<HTMLElement>(CURRENT_FLEET_CHOICE)?.focus();
        } else {
          chooser.click();
        }
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
