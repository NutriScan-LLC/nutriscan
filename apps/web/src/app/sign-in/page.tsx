"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { motion } from "framer-motion";
import { LockIcon, LogoMark, MailIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const next = searchParams.get("next") || "/scan";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    // Placeholder auth — no backend call, any credentials are accepted.
    signIn(email);
    router.push(next);
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div className="flex flex-col items-center text-center">
          <LogoMark className="h-9 w-9" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
            Welcome back
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Sign in to start your scan and track your progress.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Email
            </span>
            <span className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600">
              <MailIcon className="h-4.5 w-4.5 shrink-0 text-slate-400" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Password
            </span>
            <span className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600">
              <LockIcon className="h-4.5 w-4.5 shrink-0 text-slate-400" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-emerald-700 px-6 py-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          New to NutriScan?{" "}
          <Link
            href={`/sign-up${next !== "/scan" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-medium text-emerald-700 hover:text-emerald-800"
          >
            Create an account
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
