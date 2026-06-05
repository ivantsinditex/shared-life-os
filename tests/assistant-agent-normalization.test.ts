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

  it("keeps solo yoga requests on the current participant with public details by default", () => {
    const [action] = normalizeAgentActions({
      text: "Заплануй на наступний вівторок тренування з йоги на 13-14.",
      actions: [
        {
          ...baseCreateAction,
          title: "Тренування з йоги",
          participant: "both",
          category: "sport",
          start: "2026-06-13 13:00",
          privacy: "busy_only",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:23",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      participant: "vania",
      category: "sport",
      start: "2026-06-09 13:00",
      privacy: "shared_details",
    });
  });

  it("keeps busy-only privacy only when the user explicitly asks for it", () => {
    const [action] = normalizeAgentActions({
      text: "Заплануй йогу на вівторок о 13, показувати тільки зайнятість.",
      actions: [
        {
          ...baseCreateAction,
          title: "Йога",
          participant: "vania",
          category: "sport",
          start: "2026-06-09 13:00",
          privacy: "shared_details",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:23",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      privacy: "busy_only",
    });
  });

  it("routes natural work dashboard requests to the work dashboard action", () => {
    const [action] = normalizeAgentActions({
      text: "Покажи мені робочий дашборд.",
      actions: [
        {
          type: "task_list",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 16:38",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "work_dashboard",
    });
  });

  it("routes natural project list requests to the project list action", () => {
    const [action] = normalizeAgentActions({
      text: "Покажи список усіх проектів.",
      actions: [
        {
          type: "task_list",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 16:45",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "project_list",
    });
  });

  it("routes natural deadline requests to deadline filtering", () => {
    const [action] = normalizeAgentActions({
      text: "Покажи всі дедлайни по проекту Хмельпиво.",
      actions: [
        {
          type: "task_list",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 16:45",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "task_deadlines",
      project: "Хмельпиво",
    });
  });

  it("routes natural project task requests to a project screen", () => {
    const [action] = normalizeAgentActions({
      text: "Покажи проект Хмельпиво і список його задач.",
      actions: [
        {
          type: "task_list",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 16:45",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "project_show",
      project: "Хмельпиво",
    });
  });

  it("routes natural blocked task requests to blocked filtering", () => {
    const [action] = normalizeAgentActions({
      text: "Покажи заблоковані задачі по проекту Bar.",
      actions: [
        {
          type: "task_list",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 16:45",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "task_blocked",
      project: "Bar",
    });
  });

  it("routes priority requests with project filters", () => {
    const [action] = normalizeAgentActions({
      text: "Покажи P1 по проекту Re.emotional.",
      actions: [
        {
          type: "task_list",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 16:45",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "task_priorities",
      priority: "P1",
      project: "Re.emotional",
    });
  });

  it("understands the nearest upcoming Saturday", () => {
    const [action] = normalizeAgentActions({
      text: "Заплануй на наступну суботу тренування з йоги на 13-14.",
      actions: [
        {
          ...baseCreateAction,
          title: "Тренування з йоги",
          participant: "both",
          category: "sport",
          start: "2026-06-13 13:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:23",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      participant: "vania",
      start: "2026-06-06 13:00",
    });
  });

  it("keeps explicit next weekday from resolving to today", () => {
    const [action] = normalizeAgentActions({
      text: "Додай на наступну п'ятницю побачення з Настею з 12 по 13 дня.",
      actions: [
        {
          ...baseCreateAction,
          title: "Побачення з Настею",
          participant: "both",
          category: "together",
          start: "2026-06-05 12:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 12:18",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      participant: "both",
      category: "together",
      start: "2026-06-12 12:00",
    });
  });

  it("turns answer-only create intent into a calendar draft", () => {
    const [action] = normalizeAgentActions({
      text: "Додай на наступну суботу поїздку на пасьбу з Настею з 17 по 20.",
      actions: [
        {
          type: "answer",
          message: "Поїздка на пасьбу",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 12:32",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      title: "Поїздка на пасьбу",
      participant: "both",
      category: "together",
      start: "2026-06-06 17:00",
      durationMinutes: 180,
      privacy: "shared_details",
    });
  });

  it("understands a weekday through one week", () => {
    const [action] = normalizeAgentActions({
      text: "Заплануй суботу через одну неділю тренування з йоги на 13-14.",
      actions: [
        {
          ...baseCreateAction,
          title: "Тренування з йоги",
          participant: "vania",
          category: "sport",
          start: "2026-06-06 13:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:23",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      start: "2026-06-13 13:00",
    });
  });

  it("understands a weekday after the same weekday", () => {
    const [action] = normalizeAgentActions({
      text: "Заплануй суботу через суботу тренування з йоги на 13-14.",
      actions: [
        {
          ...baseCreateAction,
          title: "Тренування з йоги",
          participant: "vania",
          category: "sport",
          start: "2026-06-06 13:00",
        },
      ],
      timezone: "Europe/Kiev",
      now: "2026-06-05 11:23",
      currentParticipant: "vania",
    });

    expect(action).toMatchObject({
      type: "draft_create",
      start: "2026-06-13 13:00",
    });
  });
});
