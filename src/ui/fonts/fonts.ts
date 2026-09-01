import localFont from "next/font/local";

// Vendored, never fetched. See README.md in this directory and invariant 7.
//
// One face. The panel is drawn in a terminal grammar and brainless renders its
// own components from a single monospace; a display face and a sans beside it
// were what made this page read as a warm document wearing terminal chrome.
// See `docs/decisions/2026-09-01-the-brainless-palette-and-one-mono-face.md`.
export const mono = localFont({
  src: "./jetbrains-mono-variable.woff2",
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--font-mono",
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Monaco",
    "Consolas",
    "Liberation Mono",
    "monospace",
  ],
});
