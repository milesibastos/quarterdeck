import type { DeckItem, Lens } from "@/types/document.ts";
import { LensFrame } from "@/ui/lens-frame";

/**
 * The deck lens: what is queued, and what is held for a decision.
 *
 * A placeholder, and deliberately the whole of this directory. See
 * `src/ui/fleet/fleet-lens.tsx` for why each lens gets one.
 */
export function DeckLens({ lens }: { lens: Lens<readonly DeckItem[]> }) {
  const count = lens.content.length;
  return (
    <LensFrame lens={lens} name="deck" title="Deck">
      {/* One expression, so the count is one text node rather than three. */}
      <p className="text-sm text-muted-foreground">
        {`The deck lens is not built yet. ${count} ${count === 1 ? "item" : "items"} in the document.`}
      </p>
    </LensFrame>
  );
}
