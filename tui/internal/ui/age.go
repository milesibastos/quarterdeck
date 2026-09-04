package ui

import (
	"strconv"
	"time"
)

// How old the picture is, said honestly or not said at all.
//
// The number comes from the snapshot's own `generated` and from nowhere else.
// The list refreshes on its own clock and a handover can hold it still for
// minutes, so "how long ago did the fleet actually look" is a different
// question from "when did this program last ask", and only the first one tells
// an operator whether to trust what they are reading.
//
// Two things it will not do. A snapshot carrying no readable instant reads
// `age unknown` rather than being dated from the read that fetched it - an
// invented age is worse than none, because it looks like a measurement. And a
// snapshot dated ahead of this clock reads as new rather than as a negative
// age: the fixtures are dated in 2099 on purpose so they never look stale,
// which is the same ruling the web panel settled in
// `docs/decisions/2026-08-31-the-precision-a-date-carries.md`.

const unknownAge = "age unknown"

// snapshotAge is the header's own phrasing, which names its source.
func (m Model) snapshotAge() string {
	elapsed, known := m.elapsed()
	if !known {
		return "snapshot " + unknownAge
	}
	return "snapshot " + since(elapsed) + " old"
}

// compactAge is the same fact for a header that has run out of width.
func (m Model) compactAge() string {
	elapsed, known := m.elapsed()
	if !known {
		return unknownAge
	}
	return since(elapsed) + " old"
}

func (m Model) elapsed() (time.Duration, bool) {
	if m.generated.IsZero() || m.now == nil {
		return 0, false
	}
	elapsed := m.now().Sub(m.generated)
	if elapsed < 0 {
		return 0, true
	}
	return elapsed, true
}

// since is one unit and never two: an operator reading a header wants an order
// of magnitude, and `2h 14m` costs width to say the same thing as `2h`.
func since(elapsed time.Duration) string {
	switch {
	case elapsed < time.Minute:
		return strconv.Itoa(int(elapsed.Seconds())) + "s"
	case elapsed < time.Hour:
		return strconv.Itoa(int(elapsed.Minutes())) + "m"
	case elapsed < 24*time.Hour:
		return strconv.Itoa(int(elapsed.Hours())) + "h"
	}
	return strconv.Itoa(int(elapsed.Hours())/24) + "d"
}
