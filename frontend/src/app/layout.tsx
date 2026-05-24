import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Food Oasis Map",
  description: "Urban food desert analysis and optimization platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}