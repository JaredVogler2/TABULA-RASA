import type { Metadata } from "next";
import { Diagnostics } from "@/ui/diagnostics/Diagnostics";

export const metadata: Metadata = { title: "System check" };

export default function DiagnosticsPage() {
  return <Diagnostics />;
}
