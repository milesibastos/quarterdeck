import type { Metadata } from "next";
import { mono } from "@/ui/fonts/fonts.ts";
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
 * The page scrolls as a page at every width. It briefly did not - the shell was
 * one viewport tall at `md` and up, with each lens scrolling inside itself - and
 * the `h-full` chain that made that work started here. What replaced it, and
 * why, is in
 * `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${mono.variable} antialiased`}>
      <body className="min-h-svh">{children}</body>
    </html>
  );
}
