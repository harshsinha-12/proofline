export function validateOutput(
  output: { verdict: string; excerpt: string | null },
  input: { source: { textExcerpt: string } },
) {
  if ((output.excerpt && !input.source.textExcerpt.includes(output.excerpt)) ||
    (output.verdict !== "no_evidence" && !output.excerpt)) {
    throw new SyntaxError("Copy a contiguous exact substring of source.textExcerpt, preserving punctuation and whitespace. If no supporting quote exists, return no_evidence with a null excerpt.");
  }
}
