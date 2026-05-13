import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sports Collective",
  description: "Sports Collective — manage and analyze your card sets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Pacifico&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
        {/* Vercel Speed Insights: real-user Core Web Vitals (LCP, INP, CLS,
            TTFB) per route. Auto-enabled on Vercel deployments. */}
        <SpeedInsights />
        {/* Vercel Web Analytics: page views + popular routes. */}
        <Analytics />
      </body>
    </html>
  );
}
