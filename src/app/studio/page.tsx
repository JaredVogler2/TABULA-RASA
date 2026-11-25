import type { Metadata } from "next";
import { Studio } from "@/ui/studio/Studio";

export const metadata: Metadata = { title: "Studio", robots: { index: false } };

export default function StudioPage() {
  return <Studio />;
}
