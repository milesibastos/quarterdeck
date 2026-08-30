// Not a violation: this comment mentions https://example.com as prose only.
export function Notice() {
  const help = `
    Multi-line guidance for the operator, spanning
    more than one physical line on purpose.
  `;
  return <p>{help} The fleet's status is shown below.</p>;
}

export const cdn = "https://evil-cdn.example.com/widget.js";
