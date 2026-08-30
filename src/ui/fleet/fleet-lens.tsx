import type { Lens, Worker } from "@/types/document.ts";
import { LensFrame } from "@/ui/lens-frame";

/**
 * The fleet lens: what is running.
 *
 * A placeholder, and deliberately the whole of this directory. The document
 * shape it will draw from is frozen, so the worker who builds the lifecycle
 * rail and the worker cards adds files here and edits nothing anyone else owns.
 */
export function FleetLens({ lens }: { lens: Lens<readonly Worker[]> }) {
  const count = lens.content.length;
  return (
    <LensFrame lens={lens} name="fleet" title="Fleet">
      {/* One expression, so the count is one text node rather than three. */}
      <p className="text-sm text-muted-foreground">
        {`The fleet lens is not built yet. ${count} ${count === 1 ? "worker" : "workers"} in the document.`}
      </p>
    </LensFrame>
  );
}
