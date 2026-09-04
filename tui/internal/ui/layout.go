package ui

import "strings"

// The measuring is done in runes rather than in bytes, because an incident
// title carries em dashes and accents and a byte count would cut one in half.
// It is not done in display cells: that needs a width table for every emoji
// and CJK block, and the titles this list draws are prose. A row is padded to
// a rune count, and a double-width glyph would push its neighbour one cell
// right - which is a cosmetic loss, where a broken code point is a corrupt
// screen.

// ellipsis is the one character that says something was left out. It appears
// only where the whole value is somewhere else on screen - the selected row's
// detail block wraps rather than elides.
const ellipsis = "…"

func widthOf(text string) int { return len([]rune(text)) }

// elide shortens text to width, keeping both ends.
//
// Head and tail, because an incident title is identified by its subject and
// disambiguated by its tail - a date, a count, a host - and plain head
// truncation throws exactly the disambiguating half away. The split is fixed
// at two thirds head so the same title always elides to the same string.
func elide(text string, width int) string {
	runes := []rune(text)
	switch {
	case width <= 0:
		return ""
	case len(runes) <= width:
		return text
	case width == 1:
		return ellipsis
	}
	keep := width - 1
	tail := keep / 3
	head := keep - tail
	return string(runes[:head]) + ellipsis + string(runes[len(runes)-tail:])
}

// pad left-aligns text in a column.
func pad(text string, width int) string {
	if gap := width - widthOf(text); gap > 0 {
		return text + strings.Repeat(" ", gap)
	}
	return text
}

// rightAlign is the same for a number column, where the digits should line up.
func rightAlign(text string, width int) string {
	if gap := width - widthOf(text); gap > 0 {
		return strings.Repeat(" ", gap) + text
	}
	return text
}

// pair puts one value at each end of a line, and reports whether both fitted.
//
// A caller that is told they did not is expected to draw something shorter
// rather than to let the two run into each other: two facts touching read as
// one sentence, and this header's two halves answer different questions.
func pair(left, right string, width int) (string, bool) {
	gap := width - widthOf(left) - widthOf(right)
	if gap < 2 {
		return "", false
	}
	return left + strings.Repeat(" ", gap) + right, true
}

// wrap breaks text into lines no wider than width, on spaces where it can and
// mid-word only when a single word is wider than the whole line.
func wrap(text string, width int) []string {
	if width <= 0 {
		return []string{text}
	}
	var lines []string
	line := ""
	for _, word := range strings.Fields(text) {
		switch {
		case line == "":
			line = word
		case widthOf(line)+1+widthOf(word) <= width:
			line += " " + word
		default:
			lines = append(lines, line)
			line = word
		}
		for widthOf(line) > width {
			runes := []rune(line)
			lines = append(lines, string(runes[:width]))
			line = string(runes[width:])
		}
	}
	if line != "" || len(lines) == 0 {
		lines = append(lines, line)
	}
	return lines
}

// hang wraps a labelled value under a hanging indent, so the label column
// stays a column and the prose beside it stays readable.
func hang(label, value string, width int) []string {
	head := label + ": "
	indent := widthOf(head)
	// A panel too narrow to hold an indent plus a word of prose gives the
	// indent up rather than wrapping one letter per line.
	if width > 0 && width-indent < 8 {
		lines := []string{head}
		return append(lines, wrap(value, width)...)
	}
	wrapped := wrap(value, width-indent)
	lines := make([]string, 0, len(wrapped))
	for i, line := range wrapped {
		if i == 0 {
			lines = append(lines, head+line)
			continue
		}
		lines = append(lines, strings.Repeat(" ", indent)+line)
	}
	return lines
}
