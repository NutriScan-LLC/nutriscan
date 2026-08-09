"use client";

// Placeholder authentication only. There is no backend behind this — any
// email/password is accepted and nothing is verified. State lives in
// sessionStorage purely so the scan flow survives a refresh during a demo;
// it is not a session token and proves nothing. Do not treat this as real
// auth. Supabase auth wiring is out of scope here (see CLAUDE.md).

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type PlaceholderUser = {
  name: string;
  email: string;
};

type AuthContextValue = {
  status: "loading" | "signed-out" | "signed-in";
  user: PlaceholderUser | null;
  signIn: (email: string) => void;
  signUp: (name: string, email: string) => void;
  signOut: () => void;
};

const STORAGE_KEY = "nutriscan.placeholder-auth";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlaceholderUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        setUser(JSON.parse(stored) as PlaceholderUser);
        setStatus("signed-in");
        return;
      }
    } catch {
      // sessionStorage unavailable — fall through to signed-out.
    }
    setStatus("signed-out");
  }, []);

  function persist(nextUser: PlaceholderUser) {
    setUser(nextUser);
    setStatus("signed-in");
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
    } catch {
      // Ignore — in-memory state still works for this session.
    }
  }

  function signIn(email: string) {
    const name = email.split("@")[0] || "there";
    persist({ name: capitalize(name), email });
  }

  function signUp(name: string, email: string) {
    persist({ name: name || capitalize(email.split("@")[0] || "there"), email });
  }

  function signOut() {
    setUser(null);
    setStatus("signed-out");
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }

  return (
    <AuthContext.Provider value={{ status, user, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
