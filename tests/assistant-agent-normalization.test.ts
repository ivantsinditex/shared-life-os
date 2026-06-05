import { describe, expect, it } from "vitest";

import {
  type AssistantAgentAction,
  normalizeAgentActions,
} from "../src/integrations/ai/openai-assistant-agent-gateway.js";

const baseCreateAction: Extract<AssistantAgentAction, { type: "draft_create" }> = {
  type: "draft_create",
  title: "Зйомка з власницею дуплексу",
  participant: "nastia",
  category: "work",
  start: "2026-06-05 11:00",
  durationMinutes: 60,
  privacy: "busy_only",
};

describe("normalizeAgentActions", () => {
  it("moves a weekday create request to the nearest future weekday", () => {
    const [action] = normalizeAgentActions({
      text: "Заплануй, будь ласка, на понеділок на 11 зйомку з власницею дуплексу.",
      actions: [baseCreateAction],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:08",
      currentParticipant: "nastia",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      start: "2026-06-08 11:00",
    });
  });

  it("trusts an explicit day and month on create requests", () => {
    const [action] = normalizeAgentActions({
      text: "Постав на понеділок на 8 червня подію з 11 до 12 зйомка з власниці дуплекса.",
      actions: [
        {
          ...baseCreateAction,
          start: "2026-06-05 11:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:09",
      currentParticipant: "nastia",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      start: "2026-06-08 11:00",
    });
  });

  it("turns create-intent update actions into create drafts", () => {
    const [action] = normalizeAgentActions({
      text: "Постав на понеділок на 8 червня подію з 11 до 12 зйомка з власниці дуплекса.",
      actions: [
        {
          type: "draft_update_recent",
          titleContains: "Зйомка з власниці дуплекса",
          start: "2026-06-05 11:00",
          durationMinutes: 60,
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:09",
      currentParticipant: "nastia",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      title: "Зйомка з власниці дуплекса",
      participant: "nastia",
      category: "work",
      start: "2026-06-08 11:00",
    });
  });

  it("treats events with the human partner as together events", () => {
    const [action] = normalizeAgentActions({
      text: "Заплануй побачення з Настею на понеділок о 19.",
      actions: [
        {
          ...baseCreateAction,
          title: "Побачення",
          participant: "vania",
          category: "other",
          start: "2026-06-05 19:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:09",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      participant: "both",
      category: "together",
      start: "2026-06-08 19:00",
    });
  });

  it("keeps dog activities on the current participant", () => {
    const [action] = normalizeAgentActions({
      text: "Створи подію з Драйвом завтра о 12.",
      actions: [
        {
          ...baseCreateAction,
          title: "Заняття з Драйвом",
          participant: "both",
          category: "other",
          start: "2026-06-06 12:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:09",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      participant: "vania",
      category: "dogs",
    });
  });

  it("maps Gift to Nastia horse activities", () => {
    const [action] = normalizeAgentActions({
      text: "Створи заняття з Подарунком у четвер на 10.",
      actions: [
        {
          ...baseCreateAction,
          title: "Заняття з Подарунком",
          participant: "vania",
          category: "other",
          start: "2026-06-05 10:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:09",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      participant: "nastia",
      category: "horse",
      start: "2026-06-11 10:00",
    });
  });
});
