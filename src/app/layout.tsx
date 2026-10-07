import { getTenantPack } from "@/modules/tenant";
import type { Metadata } from "next";
import "./globals.css";
import { MOTION_BOOT_SCRIPT } from "@/components/motion/preference";

export const metadata: Metadata = {
  title: "Kern - AI Product OS",
  description: getTenantPack().tenant.product.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-palette={process.env.NEXT_PUBLIC_PALETTE || undefined} suppressHydrationWarning>
      <head>
        {/* 界面动效偏好要在首帧前生效（见 components/motion/preference.ts）；html 上的 data-motion 由它写入 */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
