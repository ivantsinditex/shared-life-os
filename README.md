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
/resync_calendar
/plan Title | participant | category | YYYY-MM-DD HH:mm | duration_minutes | privacy
/update short_id | Title | participant | category | YYYY-MM-DD HH:mm | duration_minutes | privacy
/task_add Title | basket | participant
/tasks [basket]
/task_move short_id | basket
/task_close short_id
/time_start basket_or_task_id | title | participant
/time_stop [participant]
/time_status [participant]
/time_today [participant]
/time_week [participant]
/analytics_today [participant]
/analytics_week [participant]
/analytics_month [participant]
```

Example:

```text
/plan Workout | vania | sport | 2026-06-01 08:00 | 60 | busy_only
/task_add Reply to urgent client | 911 | vania
/time_start deep_work | Architecture planning | vania
```

Use `/today` or `/week` to see short ids and delete buttons. Use `/sync_failed` to retry records that were saved locally but did not sync to Google Calendar. To update an activity, copy its short id and send:

```text
/update ab12cd34 | Yoga | vania | sport | 2026-06-01 19:00 | 60 | busy_only
```

Voice messages can contain the same text, for example: `/plan Workout | vania | sport | 2026-06-01 08:00 | 60 | busy_only`.
They can also use natural language, for example: `Plan workout for Vania tomorrow at 18:30 for 60 minutes, busy only`.
If the bot is missing participant, category, or privacy, it will keep a draft and ask a follow-up question with buttons.
The bot also keeps a short per-user conversation context, so follow-up phrases like `delete this one` or `remove the last workout today` can refer to recently created or listed activities.
Natural-language routing now uses an assistant agent first: the model sees recent activity context and chooses guarded app actions like draft create, list, or delete preview before the older parser fallback runs.
The assistant can also draft updates to recent activities, such as changing participant, time, category, title, duration, or privacy, and then asks for confirmation.
Natural-language voice also supports safe previews for list and bulk delete requests, for example:

```text
Show my events today
Delete all events today
Delete everything today except one workout
Delete all events today except Nastia yoga and my workout at 18:00
```

## Task Baskets

Task baskets are the lightweight work queue layer for things that may later be tracked with actual time.

Available baskets:

- `911`
- `operational`
- `deep_work`
- `random`
- `personal_brand`
- `other`

Examples:

```text
/task_add Reply to urgent client | 911 | vania
/tasks 911
/task_move ab12cd34 | deep_work
/task_close ab12cd34
```

The assistant agent can also control task baskets from natural text or voice, for example:

```text
Add "reply to urgent client" to 911 for Vania
Show 911 tasks
Move the client reply task to deep work
Close the last 911 task
```

## Time Tracking

Time tracking records actual work sessions against a basket or an existing task.

Examples:

```text
/time_start deep_work | Architecture planning | vania
/time_start ab12cd34
/time_status
/time_stop
/time_today
/time_week vania
```

The assistant agent can also control time tracking from natural text or voice:

```text
Почав deep work по архітектурі
Почала 911 задачу
Закінчив
Що зараз трекається?
Скільки сьогодні було deep work?
Скільки цього тижня було 911?
```

## Analytics

Analytics combines planned calendar activities, tracked work time, open task baskets, and active timers.
Reports include compact text bar charts: today by 6-hour blocks, week by days, and month by weeks.
When OpenAI is configured, analytics also includes a short AI insight with patterns and suggested next actions.

Examples:

```text
/analytics_today
/analytics_week
/analytics_month
/analytics_week vania
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

1. Monthly analytics foundation.
