import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BCP Live Demo — Business Commerce Protocol",
  description: "Watch two AI companies negotiate, commit, and settle a real USDC deal on Base.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", "dark", inter.variable, jetbrains.variable, "font-sans", geist.variable)}
    >
      <body className="min-h-full flex flex-col bg-[#0a0a0a] text-[#ededed]">{children}</body>
    </html>
  );
}
