package nomistakes

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Executable is the operator's no-mistakes, looked up on PATH rather than
// written down: this program must name no machine and no home.
const Executable = "no-mistakes"

// lookupTimeout bounds one `axi status` read.
//
// It talks to the shared daemon, and a daemon that has stopped answering has
// to degrade to a sentence on one row rather than to a list that never
// finishes drawing. Short, because this runs once per work item per refresh.
const lookupTimeout = 8 * time.Second

// BranchFor is the join between a work item and its pipeline run.
//
// Firstmate publishes no run id on a task, and no-mistakes keys a run by the
// branch it ran on, so the branch a worker is dispatched onto is the only
// thing the two agree about. It is matched exactly and never by prefix -
// `demo-alpha-a1` and `demo-alpha-a10` are different pieces of work, and
// attaching an operator to the wrong one is worse than telling them there is
// nothing to attach to.
func BranchFor(taskID string) string { return "fm/" + taskID }

// Attach is what one lookup concluded: a run to open, or the sentence saying
// why there is nothing to open. Exactly one of the two is set.
type Attach struct {
	RunID string
	// Why is shown on the row in place of the action. Never a machine path.
	Why string
}

// Newest is the run to attach to when a branch has several.
//
// Run ids are ULIDs, which sort lexicographically in the order they were
// minted, so the largest is the most recent. Length is compared first so that
// an id of another shape still orders deterministically rather than by luck.
func Newest(runs []Run, branch string) (Run, bool) {
	var newest Run
	found := false
	for _, run := range runs {
		if run.Branch != branch || (found && !after(run.ID, newest.ID)) {
			continue
		}
		newest, found = run, true
	}
	return newest, found
}

func after(id, than string) bool {
	if len(id) != len(than) {
		return len(id) > len(than)
	}
	return id > than
}

// Runner runs `no-mistakes` in a directory and returns everything it said.
// Injected so the join can be tested with no daemon and no repository.
type Runner func(ctx context.Context, dir string, args ...string) (string, error)

// Resolver answers, for one work item, whether its run can be opened.
type Resolver struct {
	// LookPath reports whether no-mistakes is installed at all.
	LookPath func(file string) (string, error)
	Run      Runner
}

// NewResolver is the resolver wired to the real PATH and the real command.
func NewResolver() Resolver {
	return Resolver{LookPath: exec.LookPath, Run: runCommand}
}

func runCommand(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, Executable, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return string(out), context.DeadlineExceeded
	}
	return string(out), err
}

// Resolve looks a branch's newest run up in the repository at dir.
//
// It reads and never acts: `axi status` is no-mistakes' own read-only surface,
// and nothing here starts a run, answers a gate or touches the daemon. A
// lookup that fails is a sentence on one row, not a failure of the list.
func (r Resolver) Resolve(ctx context.Context, dir, branch string) Attach {
	if _, err := r.LookPath(Executable); err != nil {
		return Attach{Why: "no-mistakes is not installed"}
	}
	out, err := r.Run(ctx, dir, "axi", "status")
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return Attach{Why: fmt.Sprintf("no-mistakes did not answer within %s", lookupTimeout)}
		}
		return Attach{Why: refusal(out)}
	}
	status := ParseStatus(out)
	if run, ok := Newest(status.Runs, branch); ok {
		return Attach{RunID: run.ID}
	}
	return Attach{Why: missing(status, branch)}
}

// missing says which kind of nothing was found.
//
// The listing `axi status` prints is bounded, so "no run is listed" and "there
// is no run" are different facts. When no-mistakes counts runs on the branch it
// is standing on and the listing does not show them, the count is what is
// believed and the row says the run is out of reach rather than absent.
func missing(status Status, branch string) string {
	if status.CountedRuns && status.RunsOnCurrentBranch > 0 && status.CurrentBranch == branch {
		return "a run exists on " + branch + " but was not among the runs listed"
	}
	return "no no-mistakes run on " + branch
}

// refusal is the first line no-mistakes refused with, which is written for a
// person - "repo not initialized", "daemon not running". Falls back to a plain
// sentence when it said nothing usable.
func refusal(out string) string {
	for _, line := range strings.Split(out, "\n") {
		if after, ok := strings.CutPrefix(strings.TrimSpace(line), "error:"); ok {
			return strings.TrimSpace(after)
		}
	}
	return "no-mistakes could not be asked about this branch"
}

// AttachCommand is the handover, built in one place so a test can read the
// argument vector without a terminal.
//
// An argument vector and a working directory, never a shell: nothing an
// operator's fleet wrote is ever handed to one for interpretation. Standard
// input, output and error are left alone - Bubble Tea's ExecProcess inherits
// them when it releases the terminal.
func AttachCommand(runID, dir string) *exec.Cmd {
	cmd := exec.Command(Executable, "attach", "--run", runID)
	cmd.Dir = dir
	return cmd
}
