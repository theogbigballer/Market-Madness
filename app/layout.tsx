import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Madness — Portfolio Simulator",
  description: "A rigorous multi-asset portfolio and derivatives simulator.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="dark"><body>{children}</body></html>;
}
