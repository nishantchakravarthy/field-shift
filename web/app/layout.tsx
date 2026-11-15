import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Field Shift — South India crop suitability 2050",
  description:
    "District-by-district map of how climate change shifts paddy, ragi and maize suitability across South India by 2050, built on NASA NEX-GDDP-CMIP6 projections and MODIS observations.",
  openGraph: {
    title: "Field Shift — South India crop suitability 2050",
    description:
      "Watch South India's crop zones shift from today to 2050, district by district, on NASA climate data.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#0E1111" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
