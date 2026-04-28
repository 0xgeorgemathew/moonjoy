import "@/lib/log.init";

import type { Metadata, Viewport } from "next";
import { Orbitron, Manrope, Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { AuthOnboardingController } from "@/components/auth-onboarding-controller";
import "./globals.css";

const orbitron = Orbitron({
  variable: "--font-display",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-label",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Moon Joy",
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
    <html
      lang="en"
      className={`${orbitron.variable} ${manrope.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body className="min-h-[100dvh] bg-surface">
        <Providers>
          <AuthOnboardingController />
          <div className="safe-area-wrapper flex h-[100dvh]">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
