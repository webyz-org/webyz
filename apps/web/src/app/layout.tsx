import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import "../styles/globals.css";
import "../styles/tailwind.css";
import { SITE_URL } from "../config/site";

// One family across marketing and product; the dashboard loads the same face.
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
  weight: ["400", "500", "600", "700"],
});

// The reference uses handwritten labels and accent words; Caveat is the
// marketing-only face for those. Vendored and subset (src/fonts/README.md)
// because the accent span inside the hero h1 is the page's LCP element and
// every byte fetched before that paint counts against it in Lighthouse's
// model: Google's latin file for this one weight is 51 KB, the variable file
// two weights pulled in was 75 KB, and the subset is 16 KB. Every .hand use
// is weight 600.
const caveat = localFont({
  src: "../fonts/caveat-600-hand.woff2",
  weight: "600",
  display: "swap",
  variable: "--font-caveat",
});

const description =
  "Understand where your visitors come from, what they do, and what converts, without cookies and without the complexity of traditional analytics.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Webyz - privacy-first analytics for actionable insights",
    template: "%s",
  },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Webyz",
    title: "Webyz - privacy-first web analytics",
    description,
    url: "/",
    images: [{ url: "/images/shot-overview.jpg", width: 1600, height: 1000, alt: "The Webyz overview dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Webyz - privacy-first web analytics",
    description,
    images: ["/images/shot-overview.jpg"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable + " " + caveat.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
