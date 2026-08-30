import type { Lens } from "@/types/document.ts";
import { Card, CardContent } from "@/ui/components/card";

/**
 * The chrome around one lens: its name, how much of it can be trusted, and
 * whatever the lens itself draws.
 *
 * Shared so the three lenses cannot drift into describing the same status three
 * different ways, and so a later worker changing one lens changes only what is
 * inside it. The `data-lens` and `data-lens-status` attributes are how a test
 * asserts that one lens went dark while the others did not.
 */

const HEADLINE: Readonly<Record<Lens<unknown>["status"]["state"], string>> = {
  fresh: "Current",
  stale: "Stale",
  unreadable: "Could not be read",
};

export function LensFrame<T>({
  lens,
  name,
  title,
  children,
}: {
  lens: Lens<T>;
  /** The lens's own name, and its handle in the markup. */
  name: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section data-lens={name} data-lens-status={lens.status.state}>
      <Card className="h-full py-0">
        <CardContent className="flex flex-col gap-3 px-4 py-4">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="font-display text-lg tracking-wide text-foreground">{title}</h2>
            <span className="font-mono text-[0.6875rem] tracking-wide uppercase text-muted-foreground">
              {HEADLINE[lens.status.state]}
            </span>
          </header>

          {lens.status.state !== "fresh" && (
            <p role="status" className="text-sm text-muted-foreground">
              {lens.status.detail}
            </p>
          )}

          {children}
        </CardContent>
      </Card>
    </section>
  );
}
