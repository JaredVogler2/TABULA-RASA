import type { Metadata } from "next";
import { Console } from "@/ui/owner/Console";

// The console is for one person. It is not linked from the game and should not be indexed.
export const metadata: Metadata = { title: "Owner console", robots: { index: false, follow: false } };

export default function OwnerPage() {
  return <Console />;
}
