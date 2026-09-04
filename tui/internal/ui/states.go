package ui

// The fleet's own state vocabulary is written for the fleet. `pr_open` and
// `waiting_external` are exact, and they are exact in a machine's register: an
// operator scanning a column wants to know who is moving, who is waiting and
// who wants them. So the list draws an operational word, and the selected row
// keeps upstream's own when the two differ - the mapping is a reading aid, and
// a reading aid that hides the source term is a second vocabulary nobody can
// check against the contract.
//
// The order here is the order the header counts are folded in, so the summary
// reads the same way twice running.
var stateOrder = []struct {
	raw   string
	label string
}{
	{"dispatched", "starting"},
	{"working", "working"},
	{"validating", "checking"},
	{"pr_open", "PR open"},
	{"in_review", "in review"},
	{"parked", "needs you"},
	{"blocked", "blocked"},
	{"paused", "waiting"},
	{"waiting_external", "waiting"},
}

// unknownState is what a state this build has never heard of reads as.
//
// Never a refusal and never a dropped row: `fleet.ActiveRows` deliberately
// keeps a worker whose state is new, and a list that then drew nothing in the
// column would be the same disappearance one screen later.
const unknownState = "unknown"

// stateLabel is the operational word for one upstream state.
func stateLabel(raw string) string {
	for _, known := range stateOrder {
		if known.raw == raw {
			return known.label
		}
	}
	return unknownState
}

// stateLabels is every label a fold can produce, in the order it is drawn.
func stateLabels() []string {
	labels := make([]string, 0, len(stateOrder)+1)
	seen := map[string]bool{}
	for _, known := range stateOrder {
		if seen[known.label] {
			continue
		}
		seen[known.label] = true
		labels = append(labels, known.label)
	}
	return append(labels, unknownState)
}
