import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SuryaVayu AI",
  description: "Day-ahead and intraday renewable generation forecasting for Karnataka grid operators.",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/plants", label: "Plants" },
  { href: "/clusters", label: "Clusters" },
  { href: "/alerts", label: "Alerts" },
  { href: "/models", label: "Models" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-orange-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div>
              <h1 className="text-2xl font-bold text-orange-700">SuryaVayu AI</h1>
              <p className="text-sm text-orange-900">
                KREDL/KSPDCL renewable generation forecasting control room
              </p>
            </div>
            <nav className="flex gap-2">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
