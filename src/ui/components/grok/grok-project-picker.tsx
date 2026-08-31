"use client";

import * as React from "react";
import { cn } from "@/ui/lib/utils";

/**
 * GrokProjectPicker — "Run Grok Build in a project directory?" chooser.
 *
 * Captured from a fresh launch outside a trusted project: left-border card
 * with `(○)` radios for recent dirs plus a free-text `z` option.
 */
const BORDER = "var(--term-rule)";
const FG = "var(--term-fg)";
const MUTED = "var(--term-muted)";
const DIM = "var(--term-faint)";

export type GrokProject = {
  id: string;
  name: string;
  /** The dim second column. Omitted when it would only repeat the name. */
  path?: string;
  /** Drawn in brackets after the name, e.g. `(current)`. */
  meta?: string;
  /** Marks the row as the one in effect, which is not the same as the one
   * selected: a chooser whose selection has moved ahead of what it is choosing
   * for needs to say both. */
  current?: boolean;
  /** Spread onto the row, so a page can address its own options. */
  data?: Record<string, string | undefined>;
};

export function GrokProjectPicker({
  title = "Run Grok Build in a project directory?",
  description = "This gives Grok Build full context of your codebase for better results.",
  projects,
  defaultSelected = 0,
  custom = true,
  onChoose,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  /** The free-text `z` row. Off where every answer is already on the list. */
  custom?: boolean;
  /** No default: the demo list upstream shipped named real repositories on
   * a real machine, which invariant 4 and the synthetic-fixtures rule both
   * forbid, and this panel always has its own fleets to offer. */
  projects: GrokProject[];
  defaultSelected?: number;
  onChoose?: (index: number | "custom") => void;
  className?: string;
}) {
  const [sel, setSel] = React.useState(defaultSelected);
  const customIndex = custom ? projects.length : -1;

  const options = [
    ...projects.map((p, i) => ({
      key: p.id,
      index: i,
      data: p.data,
      current: p.current === true,
      label: (
        <>
          <span style={{ color: FG }}>{p.name}</span>
          {p.meta ? <span style={{ color: DIM }}> ({p.meta})</span> : null}
          {p.path ? <span style={{ color: DIM }}> {p.path}</span> : null}
        </>
      ),
    })),
    ...(custom
      ? [
          {
            key: "custom",
            index: customIndex,
            data: undefined,
            current: false,
            label: <span style={{ color: MUTED }}>Type your answer here</span>,
          },
        ]
      : []),
  ];

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
      onChoose?.(i === customIndex ? "custom" : i);
    }
  }

  return (
    <div
      className={cn(
        "border-l-2 pl-3 font-mono text-[13px] leading-[1.55]",
        className,
      )}
      style={{ borderColor: BORDER }}
    >
      {title ? (
        <div className="mb-1 font-semibold" style={{ color: FG }}>
          {title}
        </div>
      ) : null}
      {description ? (
        <div className="mb-2 max-w-prose" style={{ color: MUTED }}>
          {description}
        </div>
      ) : null}

      <div role="radiogroup" aria-label={title} className="space-y-0.5">
        {options.map((opt) => {
          const active = sel === opt.index;
          const prefix =
            opt.index === customIndex ? "z" : String(opt.index + 1);
          return (
            <div
              key={opt.key}
              {...opt.data}
              aria-current={opt.current ? "true" : undefined}
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => onKey(e, opt.index)}
              onClick={() => {
                setSel(opt.index);
                onChoose?.(opt.index === customIndex ? "custom" : opt.index);
              }}
              className={cn(
                "flex cursor-pointer items-baseline gap-2 outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active && "font-semibold",
              )}
              style={{ color: active ? FG : MUTED }}
            >
              <span aria-hidden className="shrink-0 tabular-nums">
                {prefix}{" "}
                <span style={{ color: active ? FG : DIM }}>
                  {active ? "(●)" : "(○)"}
                </span>
              </span>
              <span className="min-w-0 truncate">{opt.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 text-[12px]" style={{ color: DIM }}>
        ↑/↓ navigate · Enter:submit
      </div>
    </div>
  );
}
