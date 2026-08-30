import type { Metadata } from "next";
import { display, mono, sans } from "@/ui/fonts/fonts.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quarterdeck",
  description: "Command panel for a firstmate fleet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
