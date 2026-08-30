import type { Health, Lens } from "@/types/document.ts";
import { LensFrame } from "@/ui/lens-frame";

/**
 * The shipshape lens: whether the machinery is healthy.
 *
 * A placeholder, and deliberately the whole of this directory. This is the lens
 * that can go dark on its own - its signals are read from files that carry no
 * compatibility promise - which is why the frame around it reports a status of
 * its own rather than sharing one with the fleet.
 */
export function ShipshapeLens({ lens }: { lens: Lens<Health> }) {
  return (
    <LensFrame lens={lens} name="shipshape" title="Shipshape">
      <p className="text-sm text-muted-foreground">
        The shipshape lens is not built yet.
      </p>
    </LensFrame>
  );
}
