import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import "./premium.css";

export const metadata: Metadata = {
  title: "LeadGen Pro by Rini",
  description:
    "Discover relevant businesses, manage your sales pipeline, and prepare thoughtful outreach in one workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
