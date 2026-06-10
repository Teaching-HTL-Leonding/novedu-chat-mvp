import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { StatusBar } from "@/components/status-bar";
import "katex/dist/katex.min.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HTBLA Leonding - Novedu",
  description: "HTBLA Leonding - Novedu",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <StatusBar />
        {children}
      </body>
    </html>
  );
}
