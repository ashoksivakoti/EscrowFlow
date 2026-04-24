import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { Footer } from "@/components/layout/footer";
import { AppProviders } from "@/components/providers/app-providers";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EscrowFlow",
  description: "Milestone-based freelance escrow on EVM",
  icons: {
    icon: [{ url: "/images/escrow_icon.png", type: "image/png" }],
    shortcut: [{ url: "/images/escrow_icon.png", type: "image/png" }],
    apple: [{ url: "/images/escrow_icon.png", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} min-h-dvh overflow-x-hidden bg-zinc-950 font-sans antialiased text-zinc-100`}
      >
        <AppProviders>
          <div className="flex min-h-dvh flex-col">
            <div className="flex-1">{children}</div>
            <Footer />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
