import type { Lifecycle, Stage, ValidationStep } from "@/types/document.ts";
import { cn } from "@/ui/lib/utils";

/**
 * The rail a worker travels: how far along it is, and what it is doing there.
 *
 * Two questions, deliberately answered by two different things. "How far along"
 * is the track of pips, readable without a word being read; "what exactly is it
 * doing" is the line underneath. An operator scanning the column gets the first
 * for free and pays one line of reading for the second.
 */

/** The track itself, in order. Off-track stages are not on it, by definition. */
const TRACK = ["dispatched", "working", "validating", "pr-open", "in-review", "landed"] as const;

interface StageLook {
  readonly label: string;
  /** Its index on the track, or `null` for a stage that left the track. */
  readonly position: number | null;
  /** The chip, and the card's left edge. Full class strings, so Tailwind sees them. */
  readonly chip: string;
  readonly accent: string;
  /** The pip at `position`, when the worker is standing on it. */
  readonly pip: string;
}

/**
 * One table over every stage the document can carry.
 *
 * Exhaustive by its type, so a stage added upstream cannot reach the panel
 * without someone deciding what it looks like. The four off-track stages get
 * four different tones on purpose: held wants a person, waiting wants nothing
 * from anybody, blocked wants another work item, and only failed is a fault.
 * One alarming colour for all four would hide the only one that is an alarm.
 * `unseen` is a fifth thing again and is toned as such - it says nothing about
 * the work, only that the panel cannot see it.
 *
 * Their edge is dashed as well as tinted. Hue alone has to carry ten stages
 * across six tokens, so on-track and off-track are told apart by the shape of
 * the edge - which survives both themes and does not depend on seeing colour.
 */
const STAGE: Readonly<Record<Stage, StageLook>> = {
  dispatched: {
    label: "Dispatched",
    position: 0,
    chip: "bg-muted text-muted-foreground",
    accent: "border-l-border",
    pip: "bg-muted-foreground",
  },
  working: {
    label: "Working",
    position: 1,
    chip: "bg-online text-online-foreground",
    accent: "border-l-online",
    pip: "bg-online",
  },
  validating: {
    label: "Validating",
    position: 2,
    chip: "bg-online text-online-foreground",
    accent: "border-l-online",
    pip: "bg-online",
  },
  "pr-open": {
    label: "Pull request open",
    position: 3,
    chip: "bg-info text-info-foreground",
    accent: "border-l-info",
    pip: "bg-info",
  },
  "in-review": {
    label: "In review",
    position: 4,
    chip: "bg-info text-info-foreground",
    accent: "border-l-info",
    pip: "bg-info",
  },
  landed: {
    label: "Landed",
    position: 5,
    chip: "bg-secondary text-secondary-foreground",
    accent: "border-l-secondary",
    pip: "bg-secondary",
  },
  blocked: {
    label: "Blocked",
    position: null,
    chip: "bg-secondary text-secondary-foreground",
    accent: "border-l-secondary border-dashed",
    pip: "bg-secondary",
  },
  held: {
    label: "Held",
    position: null,
    chip: "bg-warn text-warn-foreground",
    accent: "border-l-warn border-dashed",
    pip: "bg-warn",
  },
  waiting: {
    label: "Waiting",
    position: null,
    chip: "bg-info text-info-foreground",
    accent: "border-l-info border-dashed",
    pip: "bg-info",
  },
  failed: {
    label: "Failed",
    position: null,
    chip: "bg-danger text-danger-foreground",
    accent: "border-l-danger border-dashed",
    pip: "bg-danger",
  },
  /*
    Not a position on the rail and not a reason for stopping: the panel could
    not see this worker at all. Drawn in the muted tone rather than an alarming
    one, because losing sight of a worker is not the same as that worker being
    in trouble - and the whole rail stays unlit, because a stage nobody can read
    has got nowhere as far as this panel knows.
  */
  unseen: {
    label: "Unseen",
    position: null,
    chip: "bg-muted text-muted-foreground",
    accent: "border-l-muted-foreground/40 border-dashed",
    pip: "bg-muted-foreground",
  },
};

/** The pipeline's steps in the order they run, so a step can say how far in. */
const STEPS = [
  "intent",
  "rebase",
  "review",
  "test",
  "document",
  "lint",
  "push",
  "pr",
  "ci",
] as const;

/** Upstream's step names read as pipeline jargon; these read as English. */
const STEP_LABEL: Readonly<Record<ValidationStep, string>> = {
  intent: "reading the brief",
  rebase: "rebasing",
  review: "code review",
  test: "tests",
  document: "documentation",
  lint: "lint",
  push: "pushing",
  pr: "opening the pull request",
  ci: "checks",
};

export function stageAccent(stage: Stage): string {
  return STAGE[stage].accent;
}

export function StageChip({ stage }: { stage: Stage }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-4xl px-2 py-0.5 font-mono text-[0.6875rem] tracking-wide uppercase",
        STAGE[stage].chip,
      )}
    >
      {STAGE[stage].label}
    </span>
  );
}

/**
 * Where a worker got to on the track.
 *
 * An off-track stage has no position of its own, and the document does not
 * carry the stage a halted worker left the track in. What it does carry is the
 * pipeline step, and the steps only run inside validation - so a halted worker
 * naming one was validating when it stopped. A halted worker naming none gets
 * no position rather than a guessed one; see the note in fleet-lens.tsx.
 *
 * An unseen worker never reaches that deduction: the projection reads no step
 * for it, because the words it would read are upstream's account of what it
 * could not see. So the rail stays unlit rather than placing a worker the panel
 * has lost sight of somewhere on the track.
 */
function reachedIndex(lifecycle: Lifecycle): number | null {
  const own = STAGE[lifecycle.stage].position;
  if (own !== null) return own;
  return lifecycle.step === null ? null : STAGE.validating.position;
}

/**
 * The line under the track: the stage in words, and the step inside it.
 *
 * "Validating" is the answer the operator already has from the track. The step,
 * and its place in the run, is the answer they came for.
 */
function currentLine(lifecycle: Lifecycle): string {
  const { stage, step } = lifecycle;
  const where = STAGE[stage].position === null && step !== null ? " in validation" : "";
  if (step === null) return `${STAGE[stage].label}${where}`;
  return `${STAGE[stage].label}${where} · ${STEP_LABEL[step]}, step ${STEPS.indexOf(step) + 1} of ${STEPS.length}`;
}

export function LifecycleRail({ lifecycle }: { lifecycle: Lifecycle }) {
  const reached = reachedIndex(lifecycle);
  const look = STAGE[lifecycle.stage];
  const offTrack = look.position === null;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Decorative: everything it says is in the line below, in words. */}
      <div aria-hidden="true" className="flex items-center gap-1">
        {TRACK.map((stage, index) => (
          <span
            key={stage}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              reached === null
                ? "bg-muted-foreground/20"
                : index < reached
                  ? "bg-online/40"
                  : index === reached
                    ? look.pip
                    : "bg-muted-foreground/20",
              // A worker that left the track still shows how far it got, and
              // the segment it stopped on stands proud of the rest of the rail.
              offTrack && index === reached && "h-2.5 -my-0.5",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-foreground">{currentLine(lifecycle)}</p>
    </div>
  );
}
