"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowRightIcon,
  CloseIcon,
  LogOutIcon,
  LogoMark,
  MenuIcon,
  UserIcon,
} from "@/components/icons";
import { useAuth } from "@/lib/auth-context";

const NAV_LINKS = [
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Science", href: "/#science" },
  { label: "History", href: "/history" },
  { label: "Support", href: "/#" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { status, user, signOut } = useAuth();
  const signedIn = status === "signed-in";
  const pathname = usePathname();

  // The scanner flow (/scan and everything under it) is a focused, guided
  // wizard, not a marketing page — no site header, logo, nav, or Begin Scan
  // button there. Its own layout (scan/layout.tsx) supplies the only
  // navigation it gets: an Exit link and the progress indicator.
  const isScanFlow = pathname === "/scan" || pathname?.startsWith("/scan/");
  if (isScanFlow) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/90 backdrop-blur">
      <div className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            NutriScan
          </span>
        </Link>

        <nav
          className="hidden items-center justify-center gap-8 md:flex"
          aria-label="Primary"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-3">
          <div className="hidden items-center gap-4 md:flex">
            {signedIn ? (
              <>
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <UserIcon className="h-4 w-4 text-emerald-700" />
                  {user?.name}
                </span>
                <button
                  type="button"
                  onClick={signOut}
                  aria-label="Sign out"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  <LogOutIcon className="h-4.5 w-4.5" />
                </button>
              </>
            ) : (
              <Link
                href="/sign-in"
                className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
              >
                Sign in
              </Link>
            )}
            <Link
              href="/scan/welcome"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md"
            >
              Begin Scan
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 md:hidden"
          >
            {menuOpen ? (
              <CloseIcon className="h-5 w-5" />
            ) : (
              <MenuIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          aria-label="Mobile"
          className="flex flex-col gap-1 border-t border-slate-100 bg-white px-6 pb-6 pt-2 md:hidden"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-2 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50"
            >
              {link.label}
            </a>
          ))}

          {signedIn ? (
            <button
              type="button"
              onClick={() => {
                signOut();
                setMenuOpen(false);
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-2.5 text-left text-base font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOutIcon className="h-4.5 w-4.5" />
              Sign out ({user?.name})
            </button>
          ) : (
            <Link
              href="/sign-in"
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-2 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign in
            </Link>
          )}

          <Link
            href="/scan/welcome"
            onClick={() => setMenuOpen(false)}
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-700 px-5 py-3 text-sm font-medium text-white"
          >
            Begin Scan
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </nav>
      )}
    </header>
  );
}
