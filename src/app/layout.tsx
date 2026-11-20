import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofSnap: check your proof, step by step",
  description:
    "Snap a photo of a handwritten proof. ProofSnap translates it into Lean 4, the Lean proof checker verifies every step, and you see exactly where the logic breaks.",
};

export const viewport: Viewport = {
  themeColor: "#f6f3ec",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
