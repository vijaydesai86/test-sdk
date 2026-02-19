import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Information Assistant",
  description: "AI-powered stock information tool built with GitHub Copilot SDK",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
