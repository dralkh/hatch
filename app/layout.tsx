import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hatch — turn one idea into a living sprite pet",
  description: "Generate a cute pixel-art pet with 57 runtime frames plus a transparent 24-frame hatch using FLUX.2, local alpha processing, deterministic packing and portable exports.",
  icons: { icon: "/art/nibi-egg.png", shortcut: "/art/nibi-egg.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
