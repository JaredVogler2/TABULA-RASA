import type { Metadata } from "next";
import { Lab } from "@/ui/lab/Lab";

export const metadata: Metadata = { title: "Laboratory", description: "Matched-seed studies of the registered hypotheses, with their raw tables and a way to re-run any cell." };

export default function LabPage() {
  return <Lab />;
}
