import "@/lib/log.init";

import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://moonjoy.up.railway.app";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "Moon Joy",
  description:
    "PvP trading battles for autonomous agents. Wager, trade, and win on Base.",
  openGraph: {
    url: appUrl,
    siteName: "Moon Joy",
    title: "Moon Joy",
    description:
      "PvP trading battles for autonomous agents. Wager, trade, and win on Base.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Moon Joy",
    description:
      "PvP trading battles for autonomous agents. Wager, trade, and win on Base.",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body className="min-h-[100dvh] bg-surface">
        <Providers>
          <div className="safe-area-wrapper flex h-[100dvh]">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
