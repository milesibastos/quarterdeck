/**
 * Quarterdeck's mark, as a 1-bit sprite.
 *
 * A sail over a deck - the same two shapes as `src/app/icon.svg`, rasterised
 * onto a 20-column grid so `GrokLogo` can draw it as a dot matrix with the
 * shimmer sweeping across it.
 *
 * It is here rather than as an SVG path because the grammar being adopted is
 * the dot matrix and the sweep, not the artwork: `GrokLogo` takes the bits and
 * draws them. Shipping grok's own braille mark instead would be borrowing
 * somebody else's logo, which is not what "adopt the grammar" means.
 */
export const QUARTERDECK_MARK: readonly string[] = [
  "00000000011000000000",
  "00000000011000000000",
  "00000000111100000000",
  "00000000111100000000",
  "00000001111110000000",
  "00000011111111000000",
  "00000011111111000000",
  "00000111111111100000",
  "00000111111111100000",
  "00001111111111110000",
  "00001111111111110000",
  "00011111111111111000",
  "00111111111111111100",
  "00111111111111111100",
  "00000000000000000000",
  "01111111111111111110",
  "01111111111111111110",
];
