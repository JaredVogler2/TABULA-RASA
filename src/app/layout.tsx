import type { Metadata, Viewport } from "next";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/inter/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TABULA RASA — Civilization Without Instructions",
    template: "%s · TABULA RASA",
  },
  description:
    "A living miniature world of fifty independent minds. Watch, intervene and fork history in a deterministic artificial-society simulation with no civilization blueprint.",
  applicationName: "TABULA RASA",
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b130f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
