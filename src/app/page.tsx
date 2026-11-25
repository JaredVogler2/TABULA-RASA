import Link from "next/link";

// Skeleton landing page (phase 02). Replaced by the live title vista in phase 04.
export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "18vh 24px 48px" }}>
      <p style={{ fontSize: 12, letterSpacing: "0.22em", color: "var(--ember-300)", marginBottom: 12 }}>
        CIVILIZATION WITHOUT INSTRUCTIONS
      </p>
      <h1 style={{ fontSize: "clamp(40px, 9vw, 84px)", lineHeight: 1 }}>Tabula Rasa</h1>
      <p style={{ color: "var(--text-on-dark-muted)", marginTop: 20, maxWidth: "52ch" }}>
        The world engine is being assembled. Run the{" "}
        <Link href="/diagnostics" style={{ color: "var(--water-300)" }}>
          system check
        </Link>{" "}
        to verify this device can reproduce simulations exactly.
      </p>
    </main>
  );
}
