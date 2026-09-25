import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kern - AI Product OS",
  description: "食品新品研发打样门与可信决策系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-palette={process.env.NEXT_PUBLIC_PALETTE || undefined}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
