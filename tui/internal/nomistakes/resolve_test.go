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

// A lookup killed by its own budget is a different fact from one that ran and
// refused, and the row says which - the same distinction readFleet draws for
// the fleet snapshot read.
func TestResolveWhenTheLookupTimesOut(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: found, Run: answering("", context.DeadlineExceeded, &asked)}
	attach := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if attach.RunID != "" || !strings.Contains(attach.Why, "did not answer within") {
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

// Every refusal carries a kind beside its sentence, so a renderer draws a
// short label without reading the prose - and the two kinds worth telling
// apart, a repository nobody initialised and a daemon that is down, are told
// apart here rather than downstream.
func TestResolveSaysWhichKindOfNothing(t *testing.T) {
	var asked []string
	cases := []struct {
		name string
		out  string
		err  error
		path func(string) (string, error)
		kind Availability
		why  string
	}{
		{"ready", listing, nil, found, Ready, ""},
		{"no run", "current_branch: fm/other\nruns_on_current_branch: 0\n", nil, found, NoRun, "no no-mistakes run on fm/demo-alpha-a1"},
		{
			"not listed",
			"current_branch: fm/demo-alpha-a1\nruns_on_current_branch: 2\n",
			nil, found, NotListed, "was not among the runs listed",
		},
		{"repo setup", "error: repo not initialized (run 'no-mistakes init' first)\n", errors.New("exit status 1"), found, RepoSetup, "repo not initialized"},
		{"daemon down", "error: daemon not running\n", errors.New("exit status 1"), found, DaemonDown, "daemon not running"},
		{"error", "error: something else entirely\n", errors.New("exit status 1"), found, Failed, "something else entirely"},
		{"tool missing", "", nil, missingExe, ToolMissing, "not installed"},
	}
	for _, want := range cases {
		resolver := Resolver{LookPath: want.path, Run: answering(want.out, want.err, &asked)}
		got := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
		if got.Kind != want.kind {
			t.Errorf("%s: kind = %q, want %q", want.name, got.Kind, want.kind)
		}
		if want.why != "" && !strings.Contains(got.Why, want.why) {
			t.Errorf("%s: why = %q, want it to carry %q", want.name, got.Why, want.why)
		}
		if want.kind == Ready && got.RunID == "" {
			t.Errorf("%s: nothing to open", want.name)
		}
	}
}

// A lookup that outran its budget is a slow daemon, which is a different fact
// from a daemon that refused - and the kinds say which.
func TestResolveTimingOutHasItsOwnKind(t *testing.T) {
	var asked []string
	resolver := Resolver{LookPath: found, Run: answering("", context.DeadlineExceeded, &asked)}
	got := resolver.Resolve(context.Background(), "/opt/worktrees/demo-alpha-a1", "fm/demo-alpha-a1")
	if got.Kind != TimedOut {
		t.Errorf("kind = %q", got.Kind)
	}
	if !strings.Contains(got.Why, "did not answer within") {
		t.Errorf("why = %q", got.Why)
	}
}

// Every kind is in the order a summary is folded from, and every one of them
// has a label. A kind added without a place in that order is a kind nothing
// counts.
func TestEveryKindIsOrderedAndLabelled(t *testing.T) {
	seen := map[Availability]bool{}
	for _, kind := range Order {
		if seen[kind] {
			t.Errorf("%q is in the order twice", kind)
		}
		seen[kind] = true
		if kind.Label() == "" {
			t.Errorf("%q has no label", kind)
		}
	}
	for _, kind := range []Availability{
		Ready, NoRun, NotListed, RepoSetup, RemoteWorker,
		WorktreeGone, ToolMissing, TimedOut, DaemonDown, Failed,
	} {
		if !seen[kind] {
			t.Errorf("%q is not in the order a summary counts", kind)
		}
	}
}
