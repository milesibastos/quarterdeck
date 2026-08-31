import type {
  ActiveStage,
  Delivery,
  Lifecycle,
  Stage,
  ValidationStep,
  WorkerKind,
} from "@/types/document.ts";
import { cn } from "@/ui/lib/utils";

/**
 * The rail a worker travels: how far along it is, and what it is doing there.
 *
 * Two questions, deliberately answered by two different things. "How far along"
 * is the track of pips, readable without a word being read; "what exactly is it
 * doing" is the line underneath. An operator scanning the column gets the first
 * for free and pays one line of reading for the second.
 *
 * The track is not one shape. What a worker was dispatched to do decides how
 * many stages it even has - an investigation never opens a pull request, and
 * work that lands locally never goes through review - so the rail is drawn from
 * the worker's recorded kind and delivery contract, and never draws a stage the
 * work cannot reach. See `docs/decisions/2026-08-31-four-rails.md`.
 */

/**
 * The rails, each in the order its stages happen.
 *
 * Four shapes for four kinds of work, and every one of them is a subset of the
 * document's own `ActiveStage` vocabulary rather than a track of this file's
 * invention. `validated` runs the pipeline and ends in a merged pull request;
 * `direct-pr` skips the pipeline and opens one anyway, so it has no validating
 * stage at all; `local` never opens one, so it has neither of the two pull
 * request stages; and an investigation produces a report, so it has none of
 * the three.
 *
 * Keyed by `Delivery` plus `research`, so the projection's own vocabulary is
 * the key and there is no second spelling of a delivery contract in the panel.
 */
const RAIL: Readonly<Record<Delivery | "research", readonly ActiveStage[]>> = {
  validated: ["dispatched", "working", "validating", "pr-open", "in-review", "landed"],
  "direct-pr": ["dispatched", "working", "pr-open", "in-review", "landed"],
  local: ["dispatched", "working", "validating", "landed"],
  research: ["dispatched", "working", "landed"],
};

/** A rail whose length is not known. Not a fifth shape: the absence of one. */
const UNKNOWN = "unknown";

type RailShape = keyof typeof RAIL | typeof UNKNOWN;

interface StageLook {
  readonly label: string;
  /** The chip, and the card's left edge. Full class strings, so Tailwind sees them. */
  readonly chip: string;
  readonly accent: string;
  /** The pip the worker is standing on. */
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
 *
 * Where a stage sits is deliberately not in here any more. A position is only
 * meaningful against a particular rail, and a stage that is third on one rail
 * is second on another; `RAIL` above is the only thing that says where.
 */
const STAGE: Readonly<Record<Stage, StageLook>> = {
  dispatched: {
    label: "Dispatched",
    chip: "bg-muted text-muted-foreground",
    accent: "border-l-border",
    pip: "bg-muted-foreground",
  },
  working: {
    label: "Working",
    chip: "bg-online text-online-foreground",
    accent: "border-l-online",
    pip: "bg-online",
  },
  validating: {
    label: "Validating",
    chip: "bg-online text-online-foreground",
    accent: "border-l-online",
    pip: "bg-online",
  },
  "pr-open": {
    label: "Pull request open",
    chip: "bg-info text-info-foreground",
    accent: "border-l-info",
    pip: "bg-info",
  },
  "in-review": {
    label: "In review",
    chip: "bg-info text-info-foreground",
    accent: "border-l-info",
    pip: "bg-info",
  },
  landed: {
    label: "Landed",
    chip: "bg-secondary text-secondary-foreground",
    accent: "border-l-secondary",
    pip: "bg-secondary",
  },
  blocked: {
    label: "Blocked",
    chip: "bg-secondary text-secondary-foreground",
    accent: "border-l-secondary border-dashed",
    pip: "bg-secondary",
  },
  held: {
    label: "Held",
    chip: "bg-warn text-warn-foreground",
    accent: "border-l-warn border-dashed",
    pip: "bg-warn",
  },
  waiting: {
    label: "Waiting",
    chip: "bg-info text-info-foreground",
    accent: "border-l-info border-dashed",
    pip: "bg-info",
  },
  failed: {
    label: "Failed",
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
    chip: "bg-muted text-muted-foreground",
    accent: "border-l-muted-foreground/40 border-dashed",
    pip: "bg-muted-foreground",
  },
};

/** The stages a worker is standing on the track in, as a set to test against. */
const ON_TRACK: ReadonlySet<string> = new Set<ActiveStage>(RAIL.validated);

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

/** What was recorded at dispatch, which is the whole of what picks a rail. */
export interface RailFor {
  readonly kind: WorkerKind;
  readonly delivery: Delivery | null;
}

/**
 * Which rail the record describes, before anything is checked against it.
 *
 * Kind first, and deliberately: a scout's delivery contract is `null` by
 * design, and upstream has been seen writing one anyway. An investigation that
 * carries a shipping contract is still an investigation, and the rail it needs
 * is the one its work can actually reach.
 *
 * A build worker with no recognised contract is the one case with no answer.
 * The longest rail is not the safe default - it is a drawing of three stages
 * still to come for work that may already be finished - so this says it does
 * not know, and the rail below draws what that honestly looks like.
 */
function recordedShape({ kind, delivery }: RailFor): RailShape {
  if (kind === "research") return "research";
  return delivery ?? UNKNOWN;
}

/**
 * Whether the recorded rail can hold the stage the worker is standing on.
 *
 * Only the stage is tested against the record, and deliberately. A stage is a
 * fact upstream reconciled and asserted; the step beside it is a word this
 * panel's own projection fished out of upstream's prose with a first-match
 * rule, and a weak inference must not be allowed to overrule a contract that
 * was written down. So a worker naming a pipeline step on a rail that has no
 * validating stage is drawn on its recorded rail with no position claimed - see
 * `reachedIndex` - rather than being called a mismatch.
 *
 * When the stage itself is off the rail, the record and the reading disagree
 * and the record cannot be trusted for the shape. Drawing the recorded rail
 * anyway would hide the disagreement behind a stage simply missing from the
 * picture; extending it to absorb the stage would invent a rail nobody
 * recorded. Neither is honest, so it falls through to the unknown shape, which
 * says so in words.
 */
function fits(stages: readonly ActiveStage[], stage: Stage): boolean {
  return !ON_TRACK.has(stage) || stages.includes(stage as ActiveStage);
}

/**
 * The rail this worker is drawn on: the shape, and its stages when it has them.
 *
 * `stages` is `null` for the unknown shape rather than a guessed list. Every
 * reader below branches on it, which is what stops an unknown rail from being
 * drawn as a short one - "we do not know how long this is" and "this is two
 * stages long" are different pictures and must not share a code path.
 */
function railOf(
  worker: RailFor,
  lifecycle: Lifecycle,
): { readonly shape: RailShape; readonly stages: readonly ActiveStage[] | null } {
  const shape = recordedShape(worker);
  if (shape === UNKNOWN) return { shape, stages: null };
  const stages = RAIL[shape];
  return fits(stages, lifecycle.stage) ? { shape, stages } : { shape: UNKNOWN, stages: null };
}

/**
 * Where a worker got to on the rail it is drawn on.
 *
 * An off-track stage has no position of its own, and the document does not
 * carry the stage a halted worker left the track in. What it does carry is the
 * pipeline step, and the steps only run inside validation - so a halted worker
 * naming one was validating when it stopped. A halted worker naming none gets
 * no position rather than a guessed one; see the note in fleet-lens.tsx.
 *
 * The deduction needs a validating stage to land on, so on a rail that has none
 * it does not run and the worker gets no position. That is the honest end of
 * it: a contract saying the pipeline is skipped is a better witness than a word
 * read out of prose, and there is no other stage the stop could be pinned to
 * without inventing one. Closing that gap needs the stage a halted worker left
 * the track in, which the document does not carry; see the note in
 * fleet-lens.tsx.
 *
 * An unseen worker never reaches the deduction at all: the projection reads no
 * step for it, because the words it would read are upstream's account of what
 * it could not see. So the rail stays unlit rather than placing a worker the
 * panel has lost sight of somewhere on the track.
 *
 * The index is into `stages`, which differs per rail: validating is the third
 * stage of a validated rail and the third of a local one, and pull request open
 * is the fourth of the first and the third of a direct one.
 */
function reachedIndex(stages: readonly ActiveStage[], lifecycle: Lifecycle): number | null {
  const own = stages.indexOf(lifecycle.stage as ActiveStage);
  if (own !== -1) return own;
  if (lifecycle.step === null) return null;
  const validating = stages.indexOf("validating");
  return validating === -1 ? null : validating;
}

/**
 * The unknown rail's position: how far along the longest rail there is.
 *
 * Only ever used to decide how much of the track to light, never how much of it
 * to draw. A worker whose contract nobody recorded has demonstrably reached the
 * stage it is standing on, and drawing that much is a statement about the past
 * rather than a promise about the future.
 */
function reachedWithoutRail(lifecycle: Lifecycle): number | null {
  return reachedIndex(RAIL.validated, lifecycle);
}

/**
 * The step inside the stage, and its place in the run.
 *
 * Only ever said about a rail that has a validating stage. The nine steps are
 * the validation pipeline's own, so naming one - and numbering it out of nine -
 * is a claim that that pipeline is what this work goes through. On a rail whose
 * contract says the pipeline is skipped, that claim is not the panel's to make:
 * the step is a word read out of prose, and upstream's own line is drawn under
 * the rail regardless, so nothing is lost by declining to frame it.
 */
function stepClause(step: ValidationStep | null, validates: boolean): string {
  if (step === null || !validates) return "";
  return ` · ${STEP_LABEL[step]}, step ${STEPS.indexOf(step) + 1} of ${STEPS.length}`;
}

/**
 * The line under the track: where on its rail, the stage in words, and the step
 * inside it.
 *
 * The position is spelled out rather than left to the pips, because the pips
 * are decoration and everything they say has to be readable without them. It is
 * also the only thing that tells a finished three-stage rail from a worker
 * halfway down a longer one: "stage 3 of 3" is finished, and the same pip
 * pattern under a six-stage rail is not.
 *
 * "Validating" is the answer the operator already has from the track. The step,
 * and its place in the run, is the answer they came for - on the rails that
 * have a validation stage for it to be inside.
 */
function currentLine(
  lifecycle: Lifecycle,
  stages: readonly ActiveStage[] | null,
  reached: number | null,
): string {
  const { stage, step } = lifecycle;
  // An unknown rail is drawn along the longest track there is, which has a
  // validating stage; every other rail has to be asked.
  const validates = stages === null || stages.includes("validating");
  const where = !ON_TRACK.has(stage) && step !== null && validates ? " in validation" : "";
  const label = `${STAGE[stage].label}${where}`;
  const inside = stepClause(step, validates);

  if (reached === null) return `${label}${inside}`;
  if (stages === null) return `${label} · stage ${reached + 1}, of how many is not known${inside}`;

  const last = reached === stages.length - 1 && ON_TRACK.has(stage);
  return `${label} · stage ${reached + 1} of ${stages.length}${last ? ", the last of this rail" : ""}${inside}`;
}

/** Each rail shape as an operator would name it, for the sentence below. */
const SHAPE_LABEL: Readonly<Record<Delivery | "research", string>> = {
  validated: "validated delivery",
  "direct-pr": "delivery straight to a pull request",
  local: "local delivery",
  research: "an investigation",
};

/**
 * Why the panel does not know how long this rail is.
 *
 * Two different sentences, because they are two different facts and only one of
 * them is anybody's mistake. Nothing recorded is an ordinary gap - a live fleet
 * publishes a contract for most workers and not all. A record that does not fit
 * the reading is a disagreement between two things upstream said, and naming
 * the shape that was recorded is what lets an operator go and look.
 *
 * The shape, not the delivery contract: an investigation carrying a shipping
 * contract is still drawn as an investigation, so blaming the contract would
 * name a thing the rail never used.
 */
function unknownNote(recorded: RailShape): string {
  if (recorded === UNKNOWN) {
    return "No delivery contract was recorded, so how many stages this work has is not known.";
  }
  return `Recorded as ${SHAPE_LABEL[recorded]}, but that rail has no room for the stage observed, so how many stages this work has is not known.`;
}

export function LifecycleRail({
  lifecycle,
  worker,
}: {
  lifecycle: Lifecycle;
  /**
   * What was recorded when the worker was dispatched.
   *
   * The rail is drawn from this rather than from what the worker has been seen
   * doing: both facts are written down before the work starts, so the panel
   * knows the shape from the first paint and never has to infer it from
   * behaviour.
   */
  worker: RailFor;
}) {
  const { shape, stages } = railOf(worker, lifecycle);
  const reached = stages === null ? reachedWithoutRail(lifecycle) : reachedIndex(stages, lifecycle);
  const look = STAGE[lifecycle.stage];
  const offTrack = !ON_TRACK.has(lifecycle.stage);

  /*
    An unknown rail is drawn only as far as the worker has got. Hollow pips
    ahead of it would be a claim about how much is left, which is the one thing
    this shape exists to refuse; the open end says there is more and declines to
    say how much.
  */
  const drawn: readonly ActiveStage[] =
    stages ?? RAIL.validated.slice(0, reached === null ? 0 : reached + 1);

  return (
    <div className="flex flex-col gap-1.5" data-rail={shape} data-stages={stages?.length ?? "unknown"}>
      {/* Decorative: everything it says is in the lines below, in words. */}
      <div aria-hidden="true" className="flex items-center gap-1">
        {drawn.map((stage, index) => (
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
        {stages === null && (
          // The open end. Dashed rather than solid, and it is the whole of what
          // the panel will say about a rail whose length nobody recorded.
          <span className="h-1.5 flex-1 rounded-full border border-dashed border-muted-foreground/40" />
        )}
      </div>
      <p className="text-xs text-foreground">{currentLine(lifecycle, stages, reached)}</p>
      {stages === null && (
        <p className="text-xs text-muted-foreground italic">
          {unknownNote(recordedShape(worker))}
        </p>
      )}
    </div>
  );
}
