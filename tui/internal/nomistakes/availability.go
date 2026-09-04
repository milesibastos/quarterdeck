package nomistakes

import "strings"

// Availability is what Enter will do on a row, as a value rather than as a
// sentence.
//
// The list draws one short label per row and the selected row keeps the exact
// sentence, so the two have to be separable. Deciding which kind a refusal is
// belongs here, where no-mistakes' own words arrive, and not in the renderer:
// a drawing routine that matches on "repo not initialized" is a second,
// undeclared parser of somebody else's prose, and it breaks silently the day
// that sentence is reworded.
//
// The value is the label. There is no table mapping one to the other because a
// second table is a second thing to keep in step.
type Availability string

const (
	// Ready is the only kind Enter acts on.
	Ready Availability = "ready"
	// NoRun is a branch no-mistakes knows nothing about yet.
	NoRun Availability = "no run"
	// NotListed is a run upstream counted and did not list. Different from
	// NoRun on purpose - the count is believed over the bounded listing.
	NotListed Availability = "not listed"
	// RepoSetup is a repository no-mistakes was never initialised in.
	RepoSetup Availability = "repo setup"
	// RemoteWorker runs on another machine, so its terminal is not this
	// terminal's to hand over.
	RemoteWorker Availability = "remote"
	// WorktreeGone is a worktree upstream reported, that is no longer there.
	WorktreeGone Availability = "worktree gone"
	// ToolMissing is no-mistakes not being on PATH at all.
	ToolMissing Availability = "tool missing"
	// TimedOut is the lookup outrunning its budget, which is a slow daemon
	// rather than a broken one.
	TimedOut Availability = "timed out"
	// DaemonDown is no-mistakes saying its daemon is not running.
	DaemonDown Availability = "daemon down"
	// Failed is every other refusal. The selected row still carries the exact
	// words, so nothing is lost by not having a kind for it.
	Failed Availability = "error"
)

// Label is the word the list draws. An Attach that was never filled in reads
// as an error rather than as ready, because the zero value must never be the
// one kind Enter acts on.
func (a Availability) Label() string {
	if a == "" {
		return string(Failed)
	}
	return string(a)
}

// kindOf places one of no-mistakes' own refusal sentences.
//
// Two of them are worth a kind of their own because an operator's next move
// differs: a repository nobody initialised is one command away from working,
// and a daemon that is down is not this row's problem at all. Everything else
// is `error` with its sentence intact - guessing at more kinds from prose
// would be inventing structure upstream has not published.
func kindOf(reason string) Availability {
	lowered := strings.ToLower(reason)
	switch {
	case strings.Contains(lowered, "not initialized"), strings.Contains(lowered, "not initialised"):
		return RepoSetup
	case strings.Contains(lowered, "daemon") && strings.Contains(lowered, "not running"):
		return DaemonDown
	}
	return Failed
}

// Order is every kind there is, in the order a summary counts them: what Enter
// opens first, then the two kinds of nothing found, then the reasons a lookup
// was never made or never answered.
//
// Exported because it is the list a caller folds a summary from, and because a
// test that walks it is how a new kind is caught by whatever draws them.
var Order = []Availability{
	Ready,
	NoRun,
	NotListed,
	RepoSetup,
	RemoteWorker,
	WorktreeGone,
	ToolMissing,
	TimedOut,
	DaemonDown,
	Failed,
}
