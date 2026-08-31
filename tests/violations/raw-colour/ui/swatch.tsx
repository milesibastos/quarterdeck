// Plants: three ways a colour value gets written into a component - a hex, a
// colour function carrying its own numbers, and one of Tailwind's stock
// palette utilities. The comment above mentions #ff0000 and must not fire.
const BORDER = "#8b8b90";

export const Swatch = () => (
  <span
    className="bg-slate-800 text-white/70"
    style={{ borderColor: BORDER, color: "oklch(0.62 0.13 72)" }}
  />
);
