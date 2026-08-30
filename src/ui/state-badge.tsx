import type { WorkerState } from "@/types/document.ts";
import { Badge } from "@/ui/components/badge";
import { cn } from "@/ui/lib/utils";

/**
 * A worker's state, as a chip.
 *
 * The four status tokens - online, warn, danger, info - are the panel's whole
 * status vocabulary. Six states map onto them here rather than each component
 * picking a colour, so "held" looks the same everywhere it appears.
 */
const TONE: Readonly<Record<WorkerState, string>> = {
  running: "bg-online text-online-foreground",
  held: "bg-warn text-warn-foreground",
  failed: "bg-danger text-danger-foreground",
  queued: "bg-info text-info-foreground",
  finished: "bg-muted text-muted-foreground",
  idle: "bg-muted text-muted-foreground",
};

const LABEL: Readonly<Record<WorkerState, string>> = {
  running: "Running",
  held: "Held",
  failed: "Failed",
  queued: "Queued",
  finished: "Finished",
  idle: "Idle",
};

export function StateBadge({ state }: { state: WorkerState }) {
  return (
    <Badge className={cn("font-mono text-[0.6875rem] tracking-wide uppercase", TONE[state])}>
      {LABEL[state]}
    </Badge>
  );
}
