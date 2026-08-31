"use client";

import * as React from "react";
import { cn } from "@/ui/lib/utils";

/**
 * GrokHeader — Grok CLI's launch card.
 *
 * The logo is Grok's braille mark, decoded to a 1-bit sprite and drawn as a
 * crisp SVG so there are no font seams. Grok's resting animation is a grayscale
 * shimmer sweeping across the mark — reproduced here with a masked gradient
 * that translates on a loop (and holds still under prefers-reduced-motion).
 */
const LOGO_BITS = [
  "00000000000000000000000001",
  "00000000000111110000000010",
  "00000000111111111110000100",
  "00000001111111111110001000",
  "00000011111000000000011000",
  "00000111100000000000110000",
  "00001111000000000001111000",
  "00001110000000000011111000",
  "00011100000000000110111000",
  "00011100000000001100011100",
  "00011100000000010000011100",
  "00011100000000100000011100",
  "00011100000001000000011100",
  "00011100000000000000011100",
  "00011100000000000000011000",
  "00001110000000000000111000",
  "00001110000000000001111000",
  "00001110000000000011110000",
  "00001100000000000111100000",
  "00011000011111111111000000",
  "00010000111111111110000000",
  "00100000001111111000000000",
  "01000000000000000000000000",
  "10000000000000000000000000",
];

const AMBER = "var(--term-accent)"; // grok's brand amber, wearing ours

/*
 * Upstream read the media query with `useState` plus an effect that set state
 * on its first run, which this project's lint rejects: it renders once with the
 * wrong answer and then again with the right one. `useSyncExternalStore` is the
 * primitive for exactly this - an external store React did not write to - and
 * it takes a server snapshot, so the server renders the still frame rather than
 * one nobody asked for.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(REDUCED_MOTION).matches,
    // On the server there is nobody to ask. The sweep is decoration, so the
    // still frame is the safe first paint either way.
    () => true,
  );
}

/**
 * The mark, drawn as a dot matrix with the shimmer sweeping across it.
 *
 * `bits` is a prop rather than the constant above because the grammar is the
 * dot matrix and the sweep, not grok's braille mark. A product that adopts the
 * one and ships the other has borrowed somebody else's logo.
 */
export function GrokLogo({
  bits = LOGO_BITS,
  scale = 4,
  className,
}: {
  /** A 1-bit sprite: equal-length rows of "0" and "1". */
  bits?: readonly string[];
  scale?: number;
  className?: string;
}) {
  const uid = React.useId().replace(/[^a-z0-9]/gi, "");
  const reduced = usePrefersReducedMotion();
  const cols = bits[0].length;
  const rows = bits.length;

  // Grok renders each braille dot as a separate spaced dot, not filled strokes.
  const CELL = 10;
  const DOT = 5.2; // ~half the pitch, matching the real dot/gap ratio
  const off = (CELL - DOT) / 2;
  const W = cols * CELL;
  const H = rows * CELL;
  const dots: React.ReactElement[] = [];
  bits.forEach((row, y) => {
    for (let x = 0; x < cols; x += 1) {
      if (row[x] === "1") {
        dots.push(
          <rect
            key={`${x}-${y}`}
            x={x * CELL + off}
            y={y * CELL + off}
            width={DOT}
            height={DOT}
            rx={0.9}
          />,
        );
      }
    }
  });

  return (
    <svg
      aria-hidden
      width={cols * scale}
      height={rows * scale}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
    >
      <defs>
        <linearGradient
          id={`g${uid}`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={W * 0.42}
          y2={H * 0.18}
          spreadMethod="reflect"
        >
          <stop offset="0" stopColor="var(--term-faint)" />
          <stop offset="1" stopColor="var(--term-fg)" />
          {reduced ? null : (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="0 0"
              to={`${W * 0.84} ${H * 0.36}`}
              dur="2.8s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      {/* The sweep paints the dots directly. Upstream painted a full-bleed
          rect and cut it to shape with a luminance mask, which needs an opaque
          white the theme has no name for; the gradient is `userSpaceOnUse`
          across the whole viewBox either way, so the two draw the same thing
          and this one has no colour in it. */}
      <g fill={`url(#g${uid})`}>{dots}</g>
    </svg>
  );
}

/**
 * One row of the start menu.
 *
 * `onSelect` is optional, and a row without one is drawn as a plain row rather
 * than as a button. A page that has the key binding but no click target for it
 * - the binding lives elsewhere, or there is nothing to click - would otherwise
 * have to render a button that does nothing when pressed.
 */
export type GrokMenuItem = {
  label: string;
  key?: string;
  onSelect?: () => void;
};

const MENU: GrokMenuItem[] = [
  { label: "New worktree", key: "ctrl+w" },
  { label: "Resume session", key: "ctrl+s" },
  { label: "Changelog" },
  { label: "Quit", key: "ctrl+q" },
];

export function GrokHeader({
  mark = <GrokLogo className="hidden shrink-0 sm:block" />,
  name = "Grok Build Beta",
  version = "0.2.93",
  headline = "Grok 4.5 is here!",
  subhead = "Grok 4.5 is now available. Try it out in the /model picker.",
  menu = MENU,
  aside,
  className,
}: {
  /** The dot-matrix mark, or anything else. */
  mark?: React.ReactNode;
  /** A node, so the page that owns the document outline can make it a heading. */
  name?: React.ReactNode;
  version?: string;
  headline?: React.ReactNode;
  subhead?: React.ReactNode;
  menu?: GrokMenuItem[];
  /** Pinned to the trailing edge of the card, opposite the mark. */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[6px] border border-term-rule-soft px-3 py-4 font-mono text-[13px] leading-[1.5] text-term-fg sm:px-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-x-5 gap-y-3">
        {mark}
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 break-words">
            <span className="font-semibold">{name}</span>
            <span className="text-term-faint">{version}</span>
          </div>
          {headline ? (
            <div className="mt-2 break-words font-semibold" style={{ color: AMBER }}>
              {headline}
            </div>
          ) : null}
          {subhead ? (
            <div className="mt-1 break-words text-term-muted">{subhead}</div>
          ) : null}

          {menu.length ? (
            <ul className="mt-2.5 min-w-0 space-y-0.5">
              {menu.map((m) => {
                const row = (
                  <>
                    <span className="min-w-0 truncate">{m.label}</span>
                    {m.key ? (
                      <span className="shrink-0 text-term-faint">{m.key}</span>
                    ) : null}
                  </>
                );
                const shape =
                  "flex w-full min-w-0 items-center justify-between gap-4 rounded px-1 py-0.5 text-left";
                return (
                  <li key={m.label}>
                    {m.onSelect ? (
                      <button
                        type="button"
                        onClick={m.onSelect}
                        className={cn(shape, "hover:bg-term-selected")}
                      >
                        {row}
                      </button>
                    ) : (
                      <span className={shape}>{row}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {/* Full width below `sm`, where it wraps under the name and a fixed
            width would push the card sideways; capped above it, so a wide
            monitor does not stretch one badge across the masthead. */}
        {aside ? (
          <div className="w-full min-w-0 sm:w-auto sm:max-w-lg">{aside}</div>
        ) : null}
      </div>
    </div>
  );
}
