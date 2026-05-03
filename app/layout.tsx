import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL('https://sports-collective.com'),
  title: {
    default: 'Sports Collective — Built by a collector, for the collection',
    template: '%s · Sports Collective',
  },
  description:
    "A community-curated platform for vintage sports card collectors. Inventory intelligence, want-list matching, and Facebook sales tools designed for the vintage workflow.",
  keywords: [
    'vintage sports cards',
    'sports card collection manager',
    'baseball card inventory',
    'want list tracker',
    'facebook auction tools',
    'card collectors community',
  ],
  authors: [{ name: 'Sports Collective' }],
  openGraph: {
    type: 'website',
    siteName: 'Sports Collective',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
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
      </body>
    </html>
  );
}
