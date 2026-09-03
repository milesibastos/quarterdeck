package nomistakes

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func found(string) (string, error) { return "/somewhere/no-mistakes", nil }
func missingExe(string) (string, error) {
	return "", errors.New("executable file not found in $PATH")
}

// answering returns a runner that replies with one canned listing, and records
// what it was asked.
func answering(out string, err error, asked *[]string) Runner {
	return func(_ context.Context, dir string, args ...string) (string, error) {
		*asked = append(*asked, dir+" "+strings.Join(args, " "))
		return out, err
	}
}

func TestBranchForIsTheConvention(t *testing.T) {
	if got := BranchFor("demo-alpha-a1"); got != "fm/demo-alpha-a1" {
		t.Errorf("branch = %q", got)
	}
}

// The join that matters: `demo-alpha-a1` and `demo-alpha-a10` are different
// pieces of work, and a prefix match would open one operator's run from
// another's row.
func TestResolveMatchesTheBranchExactly(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: found, Run: answering(listing, nil, &asked)}

	ten := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a10", "fm/demo-alpha-a10")
	if ten.RunID != "01M1FH96NFS0GSS9P9T183WT38" {
		t.Errorf("run for the longer identifier = %+v", ten)
	}

	// The listing holds two runs on fm/demo-alpha-a1 and one on
	// fm/demo-alpha-a10. The shorter identifier must not pick up either of
	// the other two.
	one := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if one.RunID != "01M1J02SQYXYN3QZ76ZH7ZCR1V" {
		t.Errorf("run for the shorter identifier = %+v", one)
	}

	if len(asked) != 2 || !strings.Contains(asked[0], "axi status") {
		t.Errorf("asked = %v", asked)
	}
	if !strings.HasPrefix(asked[0], "/opt/worktrees/demo-alpha-a10 ") {
		t.Errorf("the lookup did not run in the work item's worktree: %v", asked)
	}
}

// Run ids are ULIDs, so the largest is the most recent - and the answer must
// not depend on the order the listing happened to arrive in.
func TestNewestIsDeterministic(t *testing.T) {
	runs := []Run{
		{ID: "01M1F9WA5Q7G2T21DACY1R5Y12", Branch: "fm/demo-alpha-a1"},
		{ID: "01M1J02SQYXYN3QZ76ZH7ZCR1V", Branch: "fm/demo-alpha-a1"},
		{ID: "01M1ZZZZZZZZZZZZZZZZZZZZZZ", Branch: "fm/demo-alpha-a10"},
	}
	newest, ok := Newest(runs, "fm/demo-alpha-a1")
	if !ok || newest.ID != "01M1J02SQYXYN3QZ76ZH7ZCR1V" {
		t.Fatalf("newest = %+v, ok = %v", newest, ok)
	}

	reversed := []Run{runs[1], runs[0], runs[2]}
	again, _ := Newest(reversed, "fm/demo-alpha-a1")
	if again.ID != newest.ID {
		t.Errorf("the order of the listing changed the answer: %q then %q", newest.ID, again.ID)
	}

	if _, ok := Newest(runs, "fm/demo-beacon-b2"); ok {
		t.Error("a branch with no runs was answered with one")
	}
}

func TestResolveWithoutTheExecutable(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: missingExe, Run: answering(listing, nil, &asked)}
	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if attach.RunID != "" || !strings.Contains(attach.Why, "not installed") {
		t.Errorf("attach = %+v", attach)
	}
	if len(asked) != 0 {
		t.Errorf("a missing executable was still run: %v", asked)
	}
}

// no-mistakes refuses in a sentence written for a person. That sentence is
// what the row says, rather than an exit status.
func TestResolveCarriesTheRefusalThrough(t *testing.T) {
	var asked []string
	refused := "error: repo not initialized (run 'no-mistakes init' first)\nhelp[1]: Run `no-mistakes init`\n"
	resolver := Resolver{LookPath: found, Run: answering(refused, errors.New("exit status 1"), &asked)}
	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if attach.RunID != "" || !strings.Contains(attach.Why, "repo not initialized") {
		t.Errorf("attach = %+v", attach)
	}
}

func TestResolveWhenNothingWasSaid(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: found, Run: answering("", errors.New("signal: killed"), &asked)}
	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if attach.RunID != "" || attach.Why == "" {
		t.Errorf("attach = %+v", attach)
	}
}

// A branch with no run at all: the honest sentence, and no guess.
func TestResolveWithNoRunOnTheBranch(t *testing.T) {
	var asked []string
	none := "current_branch: fm/demo-cutter-c3\nruns_on_current_branch: 0\nruns[1]{id,branch}:\n  01ABC,fm/demo-alpha-a1\n"
	resolver := Resolver{LookPath: found, Run: answering(none, nil, &asked)}
	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-cutter-c3", "fm/demo-cutter-c3")
	if attach.RunID != "" || !strings.Contains(attach.Why, "no no-mistakes run on fm/demo-cutter-c3") {
		t.Errorf("attach = %+v", attach)
	}
}

// The listing is bounded. When no-mistakes counts runs on the branch it is
// standing on and none of them made the list, "there is no run" would be a
// lie, so the row says the run is out of reach instead.
func TestResolveWhenTheRunIsCountedButNotListed(t *testing.T) {
	var asked []string
	beyond := "current_branch: fm/demo-cutter-c3\nruns_on_current_branch: 1\nruns[1]{id,branch}:\n  01ABC,fm/demo-alpha-a1\n"
	resolver := Resolver{LookPath: found, Run: answering(beyond, nil, &asked)}
	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-cutter-c3", "fm/demo-cutter-c3")
	if attach.RunID != "" {
		t.Fatalf("a run was invented: %+v", attach)
	}
	if !strings.Contains(attach.Why, "not among the runs listed") {
		t.Errorf("why = %q", attach.Why)
	}
}

// The handover, read as an argument vector. No shell, and the run is named
// rather than left to no-mistakes to infer.
func TestAttachCommand(t *testing.T) {
	cmd := AttachCommand("01M1J02SQYXYN3QZ76ZH7ZCR1V", "/opt/worktrees/demo-alpha-a1")
	want := []string{"no-mistakes", "attach", "--run", "01M1J02SQYXYN3QZ76ZH7ZCR1V"}
	if len(cmd.Args) != len(want) {
		t.Fatalf("args = %v, want %v", cmd.Args, want)
	}
	for i, arg := range want {
		if cmd.Args[i] != arg {
			t.Errorf("arg %d = %q, want %q", i, cmd.Args[i], arg)
		}
	}
	if cmd.Dir != "/opt/worktrees/demo-alpha-a1" {
		t.Errorf("dir = %q", cmd.Dir)
	}
	// Bubble Tea's ExecProcess is what wires the terminal through, so nothing
	// here may have claimed the streams first.
	if cmd.Stdin != nil || cmd.Stdout != nil || cmd.Stderr != nil {
		t.Error("the attach command captured a stream instead of inheriting it")
	}
}
