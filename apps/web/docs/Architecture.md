# Architecture

## Technology

Frontend

Next.js

React

TypeScript

Tailwind

Backend

Supabase

Deployment

Vercel

Hardware

WebUSB

Scanner SDK

---

# Folder Structure

src/

components/

features/

scanner/

services/

hooks/

lib/

types/

styles/

---

# Multi-Brand Architecture

Everything is configuration-driven.

No customer-specific code.

Every customer has:

theme.json

content.json

legal.json

scanner.json

branding.json

Brand is loaded at startup.

Application renders from configuration.

---

# Authentication

Supabase Auth

Email

Magic Links

OAuth (future)

---

# Database

Users

Scans

Organizations

Brands

Themes

Recommendations

History

---

# Scanner

Scanner SDK

USB only

Chrome browsers

Mac

Windows

Android

No iOS

---

# Deployment

GitHub

↓

Vercel

↓

Production

Supabase hosts backend.

---

# Future

Offline mode

Bluetooth

API

Clinician portal

Multi-location organizations