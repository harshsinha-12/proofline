"use client";

import { useEffect, useState } from "react";

/** Measure the print layout at A4 width; refuse export instead of shrinking body text. */
export function PrintFitCheck({ version, onFit }: { version: string; onFit?: (fits: boolean) => void }) {
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function measure() {
      await document.fonts.ready;
      if (cancelled) return;
      const sheet = document.querySelector(".diagnostic-sheet");
      if (!sheet) return;
      const holder = document.createElement("div");
      holder.className = "print-page";
      holder.setAttribute("aria-hidden", "true");
      Object.assign(holder.style, { position: "fixed", left: "-10000px", top: "0", width: "182mm", visibility: "hidden" });
      const clone = sheet.cloneNode(true) as HTMLElement;
      clone.style.width = "182mm";
      const pageHeight = document.createElement("div");
      pageHeight.style.height = "269mm";
      holder.append(clone, pageHeight);
      document.body.append(holder);
      const fits = clone.getBoundingClientRect().height <= pageHeight.getBoundingClientRect().height + 0.5;
      holder.remove();
      setOverflow(!fits);
      onFit?.(fits);
    }
    void measure();
    return () => { cancelled = true; };
  }, [version, onFit]);
  return overflow ? <p role="alert" className="no-print text-sm text-destructive">This diagnostic exceeds one A4 page. Shorten the draft before approval or export; body text will not be reduced.</p> : null;
}
