"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { PrintFitCheck } from "@/components/print-fit-check";

export function PrintButton() {
  const [fits, setFits] = useState(false);
  return <div><PrintFitCheck version="approved" onFit={setFits} /><Button variant="outline" disabled={!fits} onClick={() => window.print()}>Print / save PDF</Button></div>;
}
