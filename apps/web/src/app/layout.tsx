import type { Metadata } from "next";
import Header from "@/components/Header";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

// Using the system font stack (configured in globals.css) instead of
// next/font/google. This avoids a build-time fetch to Google Fonts —
// one less external dependency that can flake during a Vercel build —
// and system fonts render instantly with no layout shift. Swap in a
// branded font here once NutriScan's design system is finalized.

export const metadata: Metadata = {
  title: "NutriScan — Healthy eating shouldn’t be guesswork.",
  description:
    "See how your fruit and vegetable habits are reflected in your body with a quick, non-invasive scan. Get your NutriScore in about 2 minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-slate-900 font-sans">
        <AuthProvider>
          <Header />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
