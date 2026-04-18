import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

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
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} min-h-dvh overflow-x-hidden font-sans antialiased text-zinc-900 dark:text-zinc-50`}
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
