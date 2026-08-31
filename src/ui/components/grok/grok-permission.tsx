"use client";

import * as React from "react";
import { cn } from "@/ui/lib/utils";

/**
 * GrokPermission — Grok CLI's left-border approval card.
 *
 * Captured grammar (v0.2.93): a `┃` gutter, title + command, then numbered
 * `(●)` / `(○)` radios, over a footer legend.
 *
 * Upstream's footer read `1/3:select │ Ctrl+o:yolo │ Ctrl+c:cancel`, and this
 * component implements none of those three: there is no number-key handler, no
 * yolo and no cancel. What it does implement is the arrow keys and Enter or
 * space on a row. So the legend says that and became a prop, the same treatment
 * `GrokShortcuts` and `GrokSettings` already carry - a host that has genuinely
 * wired a key of its own says so, and one that has not inherits no claim.
 *
 * The keys were not implemented to make the old label true. A label describes
 * the surface; building behaviour to justify a label is the same defect wearing
 * the other hat.
 */
const BORDER = "var(--term-rule)"; // 38;5;8
const FG = "var(--term-fg)";
const MUTED = "var(--term-muted)";
const DIM = "var(--term-faint)";

const DEFAULT_OPTIONS = [
  "Yes, and don't ask again for anything (always-approve mode)",
  "Yes, proceed",
  "No, reject (type to add feedback)",
];

export function GrokPermission({
  title = "Write permission probe output file",
  command = "echo permission-probe-ok > probe-out.txt",
  options = DEFAULT_OPTIONS,
  defaultSelected = 0,
  legend = "↑/↓ nav · Enter/Space select",
  onChoose,
  className,
}: {
  title?: string;
  command?: string;
  options?: string[];
  defaultSelected?: number;
  /**
   * The footer legend. A prop because it is a claim about which keys work, and
   * the default names only the two this component binds itself. A page that has
   * wired anything further - a cancel, an always-approve - says so here; a page
   * that has not says nothing, which is the honest half of the same rule.
   */
  legend?: React.ReactNode;
  onChoose?: (index: number) => void;
  className?: string;
}) {
  const [sel, setSel] = React.useState(defaultSelected);

  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? (i + 1) % options.length
          : (i - 1 + options.length) % options.length;
      setSel(next);
      (e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSel(i);
      onChoose?.(i);
    }
  }

  return (
    <div className={cn("font-mono text-[13px] leading-[1.55]", className)}>
      <div
        className="border-l-2 pl-3"
        style={{ borderColor: BORDER }}
        role="group"
        aria-label={title}
      >
        <div className="mb-1" style={{ color: FG }}>
          {title}
        </div>
        <div className="mb-2" style={{ color: MUTED }}>
          {command}
        </div>

        <div role="radiogroup" aria-label={title} className="space-y-0.5">
          {options.map((opt, i) => {
            const active = sel === i;
            return (
              <div
                key={i}
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onKeyDown={(e) => onKey(e, i)}
                onClick={() => {
                  setSel(i);
                  onChoose?.(i);
                }}
                className={cn(
                  "flex cursor-pointer items-baseline gap-2 outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active && "font-semibold",
                )}
                style={{ color: active ? FG : MUTED }}
              >
                <span aria-hidden className="shrink-0 tabular-nums">
                  {i + 1}{" "}
                  <span style={{ color: active ? FG : DIM }}>
                    {active ? "(●)" : "(○)"}
                  </span>
                </span>
                <span>{opt}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Which row is selected is not repeated here as `2/3`: upstream's count
          sat where its number keys were named and read as one of them, and the
          `(●)` in the list above already says it without claiming a binding. */}
      {legend ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-2 text-[12px]"
          style={{ color: DIM }}
        >
          {legend}
        </div>
      ) : null}
    </div>
  );
}
