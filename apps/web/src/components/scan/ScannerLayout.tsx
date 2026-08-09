"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";

// Shared content card for every screen in the scanner flow (Welcome,
// System Check, and any screens added later). scan/layout.tsx already
// provides the one continuous piece of chrome shared by the whole flow —
// the exit link and the ScanStepper progress indicator — so this component
// only owns what's specific to each screen's content: icon/heading/body,
// the main content slot, and the single primary action (plus an optional
// secondary text link) pinned to the bottom of the card. Mobile-first: the
// card is full-width with generous tap targets, and gains breathing room as
// the viewport grows.

type ScannerLayoutAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
};

type ScannerLayoutProps = {
  icon?: ComponentType<{ className?: string }>;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  primaryAction: ScannerLayoutAction;
  secondaryAction?: ScannerLayoutAction;
};

export default function ScannerLayout({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
}: ScannerLayoutProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10 sm:py-14">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center text-center">
          {Icon && (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon className="h-6 w-6" />
            </span>
          )}
          {eyebrow && (
            <span className="mt-4 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              {eyebrow}
            </span>
          )}
          <h1
            className={
              "text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl " +
              (eyebrow ? "mt-1.5" : "mt-4")
            }
          >
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              {description}
            </p>
          )}
        </div>

        {children && <div className="mt-8">{children}</div>}

        <div className="mt-8 flex flex-col items-center gap-4">
          <ActionButton action={primaryAction} variant="primary" />
          {secondaryAction && (
            <ActionButton action={secondaryAction} variant="secondary" />
          )}
        </div>
      </motion.div>
    </div>
  );
}

function ActionButton({
  action,
  variant,
}: {
  action: ScannerLayoutAction;
  variant: "primary" | "secondary";
}) {
  const className =
    variant === "primary"
      ? "inline-flex w-full items-center justify-center rounded-full bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:ring-0"
      : "text-sm font-medium text-emerald-700 hover:text-emerald-800 disabled:cursor-not-allowed disabled:text-slate-400";

  if (action.href && !action.disabled) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled || action.loading}
      className={className}
    >
      {action.label}
    </button>
  );
}
