import localFont from "next/font/local";

// Vendored, never fetched. See README.md in this directory and invariant 7.
export const display = localFont({
  src: "./chango-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-display",
  fallback: ["Cooper Black", "Rockwell", "Georgia", "serif"],
});

export const sans = localFont({
  src: "./jost-variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-sans",
  fallback: [
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
});

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
