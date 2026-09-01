import type {
  ActiveStage,
  Delivery,
  HaltedStage,
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
  validated: [
    "dispatched",
    "working",
    "validating",
    "pr-open",
    "in-review",
    "landed",
  ],
  "direct-pr": ["dispatched", "working", "pr-open", "in-review", "landed"],
  local: ["dispatched", "working", "validating", "landed"],
  research: ["dispatched", "working", "landed"],
};

/** A rail whose length is not known. Not a fifth shape: the absence of one. */
const UNKNOWN = "unknown";

type RailShape = keyof typeof RAIL | typeof UNKNOWN;

interface StageLook {
  readonly label: string;
  /**
   * The mark in front of the label, in the grammar's own alphabet.
   *
   * Five glyphs: `\u25c6` for a worker on the track, `\u25c7` for one that has not
   * started or cannot be seen, `\u2713` for finished, `\u2717` for a fault, and `\u2759` for a
   * worker that has stopped without failing. Four of the five are already drawn
   * by the vendored components, so their rendering is not a new bet; the hollow
   * diamond is this lens's own and was checked on screen in both themes, which
   * is the check U+E0A0 failed when the frame was converted.
   *
   * It is decoration - the label beside it says the same thing in a word - but
   * it is the part that survives a reader who cannot tell two hues apart.
   */
  readonly glyph: string;
  /** The word and its mark, as text on the terminal ground. */
  readonly tone: string;
  /** The card's left edge. Full class strings, so Tailwind sees them. */
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
 * Their edge is dashed as well as tinted, and each carries a mark of its own.
 * Hue alone has to carry ten stages across six tokens, so on-track and
 * off-track are told apart by the shape of the edge and by the glyph in front
 * of the word - both of which survive a reader who cannot tell two hues apart.
 *
 * The tones are the panel's own status tokens rather than the `--term-*` set,
 * and that is the one place this lens does not take the grammar's palette. The
 * reason is countable: the terminal set has four saturated stops and
 * `--term-accent` is the same stop as `--term-danger`, so a stage vocabulary
 * drawn from it has no fifth hue and would paint `blocked` exactly like
 * `failed`. `--secondary` is navy, which the terminal set has no word for at
 * all, and it measures 10.1:1 light and 12.5:1 dark as text on the page. See
 * `docs/decisions/2026-08-31-the-fleet-lens-in-the-terminal-grammar.md`.
 *
 * The two obligations are split where the contrast rule needs them split: the
 * word is drawn in a rank that passes as text, the edge and the pip in the
 * status token, which carries no contrast obligation because nothing has to be
 * read out of a four-pixel rule. `--warn` is gold-600 and measures 3.2:1 as
 * text on the light page, so `held` reads in `--term-warning` - the same hue,
 * one stop darker - and keeps `--warn` on its edge.
 *
 * Where a stage sits is deliberately not in here any more. A position is only
 * meaningful against a particular rail, and a stage that is third on one rail
 * is second on another; `RAIL` above is the only thing that says where.
 */
const STAGE: Readonly<Record<Stage, StageLook>> = {
  dispatched: {
    label: "Dispatched",
    glyph: "\u25c7",
    tone: "text-term-faint",
    accent: "border-l-border",
    pip: "bg-muted-foreground",
  },
  working: {
    label: "Working",
    glyph: "\u25c6",
    tone: "text-term-success",
    accent: "border-l-online",
    pip: "bg-online",
  },
  validating: {
    label: "Validating",
    glyph: "\u25c6",
    tone: "text-term-success",
    accent: "border-l-online",
    pip: "bg-online",
  },
  "pr-open": {
    label: "Pull request open",
    glyph: "\u25c6",
    tone: "text-term-info",
    accent: "border-l-info",
    pip: "bg-info",
  },
  "in-review": {
    label: "In review",
    glyph: "\u25c6",
    tone: "text-term-info",
    accent: "border-l-info",
    pip: "bg-info",
  },
  landed: {
    label: "Landed",
    glyph: "\u2713",
    tone: "text-secondary",
    accent: "border-l-secondary",
    pip: "bg-secondary",
  },
  blocked: {
    label: "Blocked",
    glyph: "\u2759",
    tone: "text-secondary",
    accent: "border-l-secondary border-dashed",
    pip: "bg-secondary",
  },
  held: {
    label: "Held",
    glyph: "\u2759",
    tone: "text-term-warning",
    accent: "border-l-warn border-dashed",
    pip: "bg-warn",
  },
  waiting: {
    label: "Waiting",
    glyph: "\u2759",
    tone: "text-term-info",
    accent: "border-l-info border-dashed",
    pip: "bg-info",
  },
  failed: {
    label: "Failed",
    glyph: "\u2717",
    tone: "text-term-danger",
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
    glyph: "\u25c7",
    tone: "text-term-faint",
    accent: "border-l-muted-foreground/40 border-dashed",
    pip: "bg-muted-foreground",
  },
};

/** The stages a worker is standing on the track in, as a set to test against. */
const ON_TRACK: ReadonlySet<string> = new Set<ActiveStage>(RAIL.validated);

/** The stages a worker stops in, as a set to test against - `unseen` is not one. */
const HALTED: ReadonlySet<string> = new Set<HaltedStage>([
  "blocked",
  "held",
  "waiting",
  "failed",
]);

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

/**
 * Where a stop happened, as the clause that follows the stage it stopped in.
 *
 * A phrase rather than the stage's own label, because the labels are headings
 * and do not survive being dropped into a sentence: "Held in in review" is what
 * reusing them produces. Each of the six reads as an answer to "when did it
 * stop", which is the question the anchor exists to answer.
 *
 * `validating` keeps the exact wording the step deduction has always produced,
 * so an anchored stop and a deduced one read alike. They are the same claim
 * arrived at two ways, and an operator has no use for the difference.
 */
const STOPPED_IN: Readonly<Record<ActiveStage, string>> = {
  dispatched: "before it started work",
  working: "while working",
  validating: "in validation",
  "pr-open": "with its pull request open",
  "in-review": "in review",
  landed: "after it landed",
};

/**
 * The stage upstream says the worker was in when it stopped, if it said.
 *
 * Only ever asked about a stopped worker, and that gate is the whole of why
 * this is a function rather than a field read. `unseen` is not a stop - it is
 * the panel saying it cannot see the worker - so a worker the panel has lost
 * sight of is not placed on the track by a record that came from somewhere
 * else, however confidently that record asserts. An on-track worker is not
 * asked either: its position is the stage it is standing in, and where it was
 * before that is behind it.
 */
function anchorOf(lifecycle: Lifecycle): ActiveStage | null {
  return HALTED.has(lifecycle.stage) ? lifecycle.lastActiveStage : null;
}

export function stageAccent(stage: Stage): string {
  return STAGE[stage].accent;
}

/**
 * The stage, as a marked word rather than a filled pill.
 *
 * The grammar puts words on the terminal ground and reserves fills for nothing
 * at all, so the chip lost its background. What replaced it is the mark: a
 * glyph the transcript components already use, in the stage's own tone, which
 * is the same two-channel signal the pill had - shape and hue - without a
 * second ground for the contrast rule to be measured against.
 */
export function StageChip({ stage }: { stage: Stage }) {
  const { glyph, label, tone } = STAGE[stage];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-baseline gap-1.5 font-mono text-[12px] tracking-wide uppercase",
        tone,
      )}
    >
      {/* Decoration: the word beside it is the whole of what this says. */}
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}

/** What was recorded at dispatch, which is the whole of what picks a rail. */
interface RailFor {
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

/** Which of upstream's two stage claims the recorded rail had no room for. */
type Misfit = "stage" | "anchor";

/**
 * Whether the recorded rail can hold the stages upstream asserted, and if not,
 * which one it could not hold.
 *
 * Only asserted stages are tested against the record, and deliberately. A stage
 * is a fact upstream reconciled and wrote down; the step beside it is a word
 * this panel's own projection fished out of upstream's prose with a first-match
 * rule, and a weak inference must not be allowed to overrule a contract that
 * was written down. So a worker naming a pipeline step on a rail that has no
 * validating stage is drawn on its recorded rail rather than being called a
 * mismatch - see `reachedIndex` for why no position is claimed for it.
 *
 * When an asserted stage is off the rail, the record and the reading disagree
 * and the record cannot be trusted for the shape. Drawing the recorded rail
 * anyway would hide the disagreement behind a stage simply missing from the
 * picture; extending it to absorb the stage would invent a rail nobody
 * recorded. Neither is honest, so it falls through to the unknown shape, which
 * says so in words.
 *
 * The anchor is held to that same standard rather than being quietly dropped
 * when it does not fit. A worker recorded as skipping the pipeline and reported
 * as having stopped inside it is two upstream facts contradicting each other,
 * which is the same disagreement the stage test exists to surface; ignoring the
 * anchor would hide it and lose the position as well. The stage is tested
 * first, because where a worker is now is the stronger witness to which rail it
 * is on than where it was.
 */
function misfitOf(
  stages: readonly ActiveStage[],
  lifecycle: Lifecycle,
): Misfit | null {
  const { stage } = lifecycle;
  if (ON_TRACK.has(stage) && !stages.includes(stage as ActiveStage)) {
    return "stage";
  }
  const anchor = anchorOf(lifecycle);
  if (anchor !== null && !stages.includes(anchor)) return "anchor";
  return null;
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
): {
  readonly shape: RailShape;
  readonly stages: readonly ActiveStage[] | null;
  /** `null` when nothing was dropped: no rail was recorded to drop. */
  readonly misfit: Misfit | null;
} {
  const shape = recordedShape(worker);
  if (shape === UNKNOWN) return { shape, stages: null, misfit: null };
  const stages = RAIL[shape];
  const misfit = misfitOf(stages, lifecycle);
  return misfit === null
    ? { shape, stages, misfit }
    : { shape: UNKNOWN, stages: null, misfit };
}

/**
 * Where a worker got to on the rail it is drawn on.
 *
 * Three answers tried in order of how much they are worth, and the order is the
 * point.
 *
 * An on-track worker is standing on its own stage, and that is the end of it.
 *
 * A stopped worker is placed by the stage upstream recorded it as last being
 * in. That is an assertion rather than a reading - upstream watched the worker
 * and wrote down where it was - so it outranks anything this file can work out,
 * and it is the only answer that reaches a rail with no validating stage on it.
 * It is what makes a stop placeable on all four shapes rather than one.
 *
 * Failing that, the pipeline step. The steps only run inside validation, so a
 * stopped worker naming one was validating when it stopped. It is a deduction
 * off a word read out of upstream's prose, which is why it goes last, and it
 * needs a validating stage to land on: on a rail that has none - direct-pr,
 * research - it does not run. Falling back to that rail's `working` stage
 * instead is tempting and is a guess dressed as a deduction, because on a rail
 * whose contract skips the pipeline the step word evidences nothing about which
 * stage the worker stopped in; a worker held after its pull request opened
 * would be walked back to `working` by exactly that reasoning.
 *
 * A pull request is not the missing evidence either. It proves a worker
 * REACHED a stage; a position claims it STOPPED there, and those are different
 * claims - a worker blocked during in-review has one and did not stop at
 * pr-open. Upstream asserting the anchor is the difference between being told
 * that and inferring it. Where nobody asserted one, the honest end of it is
 * still no position, said in words by `currentLine`.
 *
 * An unseen worker reaches none of it: `anchorOf` refuses it a stop's anchor,
 * and the projection reads no step for it, because the words it would read are
 * upstream's account of what it could not see. So the rail stays unlit rather
 * than placing a worker the panel has lost sight of somewhere on the track.
 *
 * The index is into `stages`, which differs per rail: validating is the third
 * stage of a validated rail and the third of a local one, and pull request open
 * is the fourth of the first and the third of a direct one.
 */
function reachedIndex(
  stages: readonly ActiveStage[],
  lifecycle: Lifecycle,
): number | null {
  const own = stages.indexOf(lifecycle.stage as ActiveStage);
  if (own !== -1) return own;
  const anchor = anchorOf(lifecycle);
  if (anchor !== null) {
    const at = stages.indexOf(anchor);
    if (at !== -1) return at;
  }
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
 *
 * `reached` is `null` for a halted worker with nothing to place it by - one
 * that named no step, or one on a rail with no validating stage for its step to
 * land on - and for the unseen stage, and the two must not read alike. A halted
 * worker says in words that its position is not known, which is the truth and
 * is what an unlit rail on its own fails to say; an unseen worker's bare label
 * already says the panel has no standing to claim anything about it - see the
 * note in fleet-lens.tsx.
 */
function currentLine(
  lifecycle: Lifecycle,
  stages: readonly ActiveStage[] | null,
  reached: number | null,
): string {
  const { stage, step } = lifecycle;
  const anchor = anchorOf(lifecycle);
  // An unknown rail is drawn along the longest track there is, which has a
  // validating stage; every other rail has to be asked.
  const validates = stages === null || stages.includes("validating");
  /*
    Where upstream says the stop happened wins over where this file deduced it,
    the same order `reachedIndex` reads them in - so the words under the track
    and the pip on it never name two different stages.

    The step is framed as a pipeline run only when the stop is placed inside
    validation. An anchored stop elsewhere on the rail must not be: numbering a
    step out of nine beside "with its pull request open" would claim the worker
    was in the pipeline at the moment it stopped, when upstream said it was not.
    Upstream's own line is drawn under the rail either way, so the step word
    itself is never lost - only the frame this file would have put around it.
  */
  const where =
    anchor !== null
      ? ` ${STOPPED_IN[anchor]}`
      : !ON_TRACK.has(stage) && step !== null && validates
        ? " in validation"
        : "";
  const label = `${STAGE[stage].label}${where}`;
  const inside = stepClause(
    step,
    anchor === null ? validates : anchor === "validating",
  );

  if (reached === null) {
    return HALTED.has(stage)
      ? `${label} · position not known${inside}`
      : `${label}${inside}`;
  }
  if (stages === null)
    return `${label} · stage ${reached + 1}, of how many is not known${inside}`;

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
 * Three different sentences, because they are three different facts and only
 * two of them are anybody's mistake. Nothing recorded is an ordinary gap - a
 * live fleet publishes a contract for most workers and not all. A record that
 * does not fit the reading is a disagreement between two things upstream said,
 * and naming the shape that was recorded is what lets an operator go and look.
 *
 * The two disagreements are told apart because an operator chasing one looks in
 * a different place than an operator chasing the other: a rail with no room for
 * where the worker is now is a contradiction about a live reading, and one with
 * no room for where it stopped is a contradiction about a record written when
 * it stopped.
 *
 * The shape, not the delivery contract: an investigation carrying a shipping
 * contract is still drawn as an investigation, so blaming the contract would
 * name a thing the rail never used.
 */
function unknownNote(recorded: RailShape, misfit: Misfit | null): string {
  if (recorded === UNKNOWN || misfit === null) {
    return "No delivery contract was recorded, so how many stages this work has is not known.";
  }
  const room =
    misfit === "anchor" ? "the stage it stopped in" : "the stage observed";
  return `Recorded as ${SHAPE_LABEL[recorded]}, but that rail has no room for ${room}, so how many stages this work has is not known.`;
}

/**
 * The rail's own name, for the frame's header.
 *
 * The same table the sentence below uses, so a contract still has exactly one
 * spelling in the panel. A rail whose length is not known says that here too
 * rather than borrowing a name it has no claim to; the paragraph underneath is
 * where the two reasons for not knowing are told apart.
 */
function railName(shape: RailShape): string {
  return shape === UNKNOWN ? "rail not known" : SHAPE_LABEL[shape];
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
  const { shape, stages, misfit } = railOf(worker, lifecycle);
  const reached =
    stages === null
      ? reachedWithoutRail(lifecycle)
      : reachedIndex(stages, lifecycle);
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

  /*
    A framed box with a named head, which is the grammar's shape for a thing the
    session is working through. The frame is solid on purpose: dashed is this
    rail's word for an end nobody promised, and a dashed box would say that
    about every rail on the page. The list inside is horizontal rather than the
    grammar's column of numbered steps - see the decision record; the card's
    proportions are the wireframe's and a six-row rail would re-cut them.
  */
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-sm border border-term-rule-soft px-2 py-1.5"
      data-rail={shape}
      data-stages={stages?.length ?? "unknown"}
    >
      {/* The head names the rail being drawn, which is a fact from dispatch and
          was previously only said when it was missing. Decorative rule, real
          word: the sentence below still carries the length. */}
      <div className="flex min-w-0 items-baseline gap-1.5 font-mono text-[12px] text-term-faint">
        <span aria-hidden="true">─</span>
        <span className="min-w-0 truncate">{railName(shape)}</span>
      </div>

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

      {/* Literal class strings, not `cn`: `tests/fleet-lens.test.ts` reads these
          two sentences out of the markup by matching a paragraph whose class
          begins with the size, and every claim the rail makes is in them. */}
      <p className="text-xs text-term-fg">
        {currentLine(lifecycle, stages, reached)}
      </p>
      {stages === null && (
        <p className="text-xs text-term-muted italic">
          {unknownNote(recordedShape(worker), misfit)}
        </p>
      )}
    </div>
  );
}
