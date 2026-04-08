import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BCP — Business Commerce Protocol",
  description:
    "The open protocol for AI agent commerce. Negotiation, escrow, and settlement between autonomous agents — built on x402.",
  keywords: [
    "BCP",
    "Business Commerce Protocol",
    "AI agents",
    "x402",
    "B2B commerce",
    "on-chain escrow",
    "agent negotiation",
  ],
  openGraph: {
    title: "BCP — Business Commerce Protocol",
    description:
      "The open protocol for AI agent commerce. Built on x402. Apache 2.0.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BCP — Business Commerce Protocol",
    description:
      "The open protocol for AI agent commerce. Built on x402. Apache 2.0.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-white text-foreground antialiased">{children}</body>
    </html>
  );
}
