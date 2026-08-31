import type { Metadata } from "next";
import { display, mono, sans } from "@/ui/fonts/fonts.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quarterdeck",
  description: "Command panel for a firstmate fleet.",
};

/**
 * No class decides the theme. Light and dark are both `prefers-color-scheme`
 * rules in `globals.css`, so the browser paints the operator's setting on the
 * first frame and there is no script whose absence would flash the wrong one.
 * See `docs/decisions/2026-08-31-the-theme-follows-the-system.md`.
 *
 * `h-full` down to the body is what lets the shell be exactly one viewport tall
 * at `md` and up, with each lens scrolling inside itself instead of the page
 * scrolling as a whole. Below `md` the body grows and the page scrolls
 * normally; see `src/ui/shell.tsx`.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full md:h-full md:overflow-hidden">{children}</body>
    </html>
  );
}
