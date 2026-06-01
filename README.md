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
- Google Calendar free/busy checks for manually-created calendar blocks;
- Google Calendar gateway for event creation when credentials are configured;
- retry flow for locally saved activities whose calendar sync failed;
- voice message transcription for `/plan` and `/update` commands when OpenAI is configured;
- natural-language AI parsing for voice planning requests.

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
/sync_failed
/plan Title | participant | category | YYYY-MM-DD HH:mm | duration_minutes | privacy
/update short_id | Title | participant | category | YYYY-MM-DD HH:mm | duration_minutes | privacy
```

Example:

```text
/plan Workout | vania | sport | 2026-06-01 08:00 | 60 | busy_only
```

Use `/today` or `/week` to see short ids and delete buttons. Use `/sync_failed` to retry records that were saved locally but did not sync to Google Calendar. To update an activity, copy its short id and send:

```text
/update ab12cd34 | Yoga | vania | sport | 2026-06-01 19:00 | 60 | busy_only
```

Voice messages can contain the same text, for example: `/plan Workout | vania | sport | 2026-06-01 08:00 | 60 | busy_only`.
They can also use natural language, for example: `Plan workout for Vania tomorrow at 18:30 for 60 minutes, busy only`.
Natural-language voice also supports safe previews for list and bulk delete requests, for example:

```text
Show my events today
Delete all events today
Delete everything today except one workout
Delete all events today except Nastia yoga and my workout at 18:00
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

## Voice Access

Voice transcription and natural-language planning are optional and use OpenAI. Add `OPENAI_API_KEY` to `.env` to enable them.

## Next Implementation Slice

1. Richer guided Telegram planning flow with follow-up questions for missing fields.
2. Natural-language parsing for text messages, not only voice.
3. Monthly analytics foundation.
