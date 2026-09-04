// The two shapes `no-mistakes axi status` answers in, and the join reading each
// of them. Kept apart from resolve_test.go because it is a boundary of its own:
// what production asks for, and what comes back.
package nomistakes

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// answeringCommand replies according to what was actually asked.
//
// The fake the first version of this package shipped with returned one canned
// listing whatever the arguments were, which is how a parser written for the
// overview passed a suite that also asserted production asks for `axi status`.
// Each half was proved and the join between them was not.
func answeringCommand(replies map[string]string, asked *[]string) Runner {
	return func(_ context.Context, dir string, args ...string) (string, error) {
		command := strings.Join(args, " ")
		*asked = append(*asked, dir+" "+command)
		out, ok := replies[command]
		if !ok {
			return "error: unknown command " + command + "\n", errors.New("exit status 2")
		}
		return out, nil
	}
}

// The defect this package was corrected for: `axi status` describes the
// current branch's run in a nested object, and that object is what production
// asks for, so it is what has to become the run Enter opens.
func TestResolveOpensTheRunAxiStatusDetails(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: found, Run: answeringCommand(map[string]string{
		"axi status": detailed,
		"axi":        listing,
	}, &asked)}

	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if attach.Kind != Ready || attach.RunID != "01M1PCQKPF2T5N3MN7MJX618Y5" {
		t.Fatalf("attach = %+v", attach)
	}
	if len(asked) != 1 || asked[0] != "/opt/worktrees/demo-alpha-a1 axi status" {
		t.Errorf("asked = %v, want one `axi status` in the work item's worktree", asked)
	}
}

// The nested object names its own branch, and that branch is matched exactly
// too - a detailed run on `fm/demo-alpha-a1` is not the run for
// `fm/demo-alpha-a10`.
func TestResolveWillNotOpenANearPrefixFromTheNestedRun(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: found, Run: answeringCommand(map[string]string{
		"axi status": detailed,
	}, &asked)}

	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a10", "fm/demo-alpha-a10")
	if attach.RunID != "" || attach.Kind != NoRun {
		t.Errorf("attach = %+v", attach)
	}
}

// An object missing the id or the branch was understood and answered
// incompletely, which is not the same fact as a branch with no run. The row
// says so rather than claiming an absence it did not establish.
func TestResolveWillNotCallAnIncompleteRunAnAbsence(t *testing.T) {
	var asked []string
	for name, out := range map[string]string{
		"no id":     "run:\n  branch: fm/demo-alpha-a1\n  status: running\n",
		"no branch": "run:\n  id: \"01M1J02SQYXYN3QZ76ZH7ZCR1V\"\n  status: running\n",
	} {
		resolver := Resolver{LookPath: found, Run: answeringCommand(map[string]string{"axi status": out}, &asked)}
		attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
		if attach.RunID != "" {
			t.Errorf("%s: a run was invented: %+v", name, attach)
		}
		if attach.Kind != Failed || attach.Why == "" {
			t.Errorf("%s: attach = %+v", name, attach)
		}
		if strings.Contains(attach.Why, "no no-mistakes run on") {
			t.Errorf("%s: an incomplete answer was reported as an absence: %q", name, attach.Why)
		}
	}
}

// `axi status` has no current run to detail in a worktree that has left its
// branch, and falls back to the bounded overview. That fallback is still read.
func TestResolveReadsTheOverviewFallback(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: found, Run: answeringCommand(map[string]string{
		"axi status": detached,
	}, &asked)}

	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if attach.Kind != Ready || attach.RunID != "01M1PCQKPF2T5N3MN7MJX618Y5" {
		t.Errorf("attach = %+v", attach)
	}
}
