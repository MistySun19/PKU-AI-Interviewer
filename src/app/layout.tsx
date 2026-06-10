import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Traceback",
  description: "你的 GitHub 项目，真的经得起面试官追问吗？"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="data:," />
      </head>
      <body>{children}</body>
    </html>
  );
}
