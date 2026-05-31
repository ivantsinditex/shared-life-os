# Shared Life OS

Telegram-first planning system for shared weekly life planning, Google Calendar availability, task baskets, time tracking, and later analytics.

## Current Slice

This repository currently covers the T1-T4 foundation:

- runnable TypeScript/Node.js service shell;
- environment configuration;
- known-user mapping for Vania and Nastia;
- planned activity domain model;
- file-based planned activity repository for MVP development;
- Telegram command shell for health and planning summaries;
- `/plan` command with confirmation buttons;
- local conflict detection with suggested alternatives;
- Google Calendar gateway for event creation when credentials are configured.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Telegram Commands

```text
/health
/today
/week
/plan Title | participant | category | YYYY-MM-DD HH:mm | duration_minutes | privacy
```

Example:

```text
/plan Workout | vania | sport | 2026-06-01 08:00 | 60 | busy_only
```

## Planned Activity Concept

A planned activity is the product source of truth for calendar planning. Google Calendar is the synchronized availability surface, not the only place where product meaning lives.

Core fields:

- participant: `vania`, `nastia`, or `both`;
- category: sport, work, learning, reading, dogs, horse, care, together, other;
- start/end time;
- recurrence group, when generated from a repeated plan;
- privacy: private, busy-only, or shared details;
- sync status and Google Calendar event id.

## Calendar Access

The bot writes all planned activities to the shared calendar configured as `GOOGLE_CALENDAR_ID`.
That calendar must be shared with the service account email using **Make changes to events**.

## Next Implementation Slice

1. Richer guided Telegram planning flow with follow-up questions for missing fields.
2. Calendar retry flow for records with failed sync.
3. Google Calendar free/busy conflict checks in addition to local planned activity checks.
4. Update/delete flows.
