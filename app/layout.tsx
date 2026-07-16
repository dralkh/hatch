import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hatch.amayx.com/"),
  title: "Hatch — turn one idea into a living sprite pet",
  description: "Generate a cute pixel-art pet with 57 runtime frames plus a transparent 24-frame hatch using FLUX.2, local alpha processing, deterministic packing and portable exports.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Hatch",
    title: "Hatch — turn one idea into a living sprite pet",
    description: "Generate consistent, transparent and playable pixel-art pet packages from one creature idea.",
    images: [{ url: "/art/nibi-idle.png", width: 1024, height: 1024, alt: "Nibi, Hatch's mint pixel-art moon-moth kitten" }],
  },
  twitter: {
    card: "summary",
    title: "Hatch — turn one idea into a living sprite pet",
    description: "Generate consistent, transparent and playable pixel-art pet packages from one creature idea.",
    images: ["/art/nibi-idle.png"],
  },
  icons: { icon: "/art/nibi-egg.png", shortcut: "/art/nibi-egg.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
