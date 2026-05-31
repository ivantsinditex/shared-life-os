# Shared Life OS

Telegram-first planning system for shared weekly life planning, Google Calendar availability, task baskets, time tracking, and later analytics.

## Current Slice

This repository starts with the technical-plan T1-T2 foundation:

- runnable TypeScript/Node.js service shell;
- environment configuration;
- known-user mapping for Vania and Nastia;
- planned activity domain model;
- file-based planned activity repository for MVP development;
- Telegram command shell for health and planning summaries.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
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

## Next Implementation Slice

T3-T4:

1. Guided Telegram planning flow.
2. Google Calendar event gateway.
3. Confirmation before calendar writes.
4. Calendar sync status updates.
