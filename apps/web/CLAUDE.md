# CLAUDE.md

# NutriScan

NutriScan is a configurable, white-label web platform for hardware scanners.

The goal is to create the simplest, most trustworthy scanner experience possible.

---

# Read First

Before making architectural or UX decisions, read these documents in order:

1. docs/Product.md
2. docs/Design-System.md
3. docs/Architecture.md
4. docs/Scanner.md

These documents are the project's source of truth.

---

# Working Principles

Optimize for:

1. User Experience
2. Simplicity
3. Reliability
4. Reusability
5. Performance

Always prefer the simplest solution that satisfies the requirements.

---

# Design Principles

NutriScan should feel:

- Modern
- Clinical
- Wellness-focused
- Calm
- Premium
- Trustworthy

Every screen should have:

- One primary action
- Minimal text
- Clear hierarchy
- Generous whitespace

---

# Architecture Principles

- Keep scanner logic separate from UI.
- Never communicate directly with WebUSB from React components.
- Reuse components before creating new ones.
- Use configuration instead of hardcoded customer-specific logic.
- Build one application that supports many brands.

---

# Scanner Rules

Never invent or modify scanner protocol behavior.

If scanner behavior is uncertain:

- Ask for clarification.
- Update `docs/Scanner.md` before changing protocol code.

---

# Working Style

Before coding:

- Understand the request.
- Explain the implementation plan for significant work.

When coding:

- Keep changes focused.
- Do not refactor unrelated code.
- Prefer reusable components.
- Avoid unnecessary dependencies.

Before finishing:

- Run lint.
- Run TypeScript checks.
- Verify responsive layouts.

---

# Current Milestone

Current focus is building the core scanner experience:

- Homepage
- Scanner connection
- Login / Guest flow
- Tutorial
- Quick & Precision Scan
- Scan progress
- Results

Do not build future roadmap features unless requested.