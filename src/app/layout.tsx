import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PKU AI Interviewer",
  description: "GitHub repo 项目考核面试生成器"
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
