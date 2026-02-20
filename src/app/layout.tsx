import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Influencer Manipulation Detector",
  description: "Detect psychological manipulation tactics in Instagram Reels using AI-powered analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
