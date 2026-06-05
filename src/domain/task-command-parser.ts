import { participants, type Participant } from "./planned-activity.js";
import { taskBaskets, taskPriorities, type TaskBasket, type TaskPriority } from "./task.js";

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ParsedTaskAdd = {
  title: string;
  basket: TaskBasket;
  participant?: Participant;
  project?: string;
  priority?: TaskPriority;
  deadline?: string;
};

export type ParsedTaskMove = {
  shortId: string;
  basket: TaskBasket;
};

export function getTaskAddUsage(): string {
  return [
    "Формат:",
    "/task_add Назва | кошик | учасник | проект | пріоритет | дедлайн",
    "",
    "Приклад:",
    "/task_add ТЗ на креативи | операційка | Настя | Хмельпиво | P1 | 2026-06-06",
    "",
    "Кошики: 911, операційка, deep work, рандом, особистий бренд, інше",
    "Учасники: Ваня, Настя, Разом (необов'язково)",
    "Пріоритет: P1, P2, P3, P4. Дедлайн: YYYY-MM-DD.",
  ].join("\n");
}

export function getTaskMoveUsage(): string {
  return [
    "Формат:",
    "/task_move короткий_id | новий кошик",
    "",
    "Приклад:",
    "/task_move ab12cd34 | deep work",
    "",
    "Кошики: 911, операційка, deep work, рандом, особистий бренд, інше",
  ].join("\n");
}

export function parseTaskAddCommand(input: string): ParseResult<ParsedTaskAdd> {
  const parts = splitCommand(input);

  if (parts.length < 2 || parts.length > 6) {
    return { ok: false, error: getTaskAddUsage() };
  }

  const [title, basketInput, participantInput, projectInput, priorityInput, deadlineInput] = parts;
  const basket = parseTaskBasket(basketInput);

  if (!title) {
    return { ok: false, error: "Потрібна назва задачі." };
  }

  if (!basket) {
    return { ok: false, error: `Не знаю такого кошика: ${basketInput}\n\n${getTaskAddUsage()}` };
  }

  const participant = participantInput ? parseParticipant(participantInput) : undefined;

  if (participantInput && !participant) {
    return { ok: false, error: `Не знаю такого учасника: ${participantInput}` };
  }

  const priority = priorityInput ? parseTaskPriority(priorityInput) : undefined;

  if (priorityInput && !priority) {
    return { ok: false, error: `Не знаю такого пріоритету: ${priorityInput}. Можна: ${taskPriorities.join(", ")}` };
  }

  return {
    ok: true,
    value: {
      title,
      basket,
      participant,
      project: projectInput,
      priority,
      deadline: deadlineInput,
    },
  };
}

export function parseTaskMoveCommand(input: string): ParseResult<ParsedTaskMove> {
  const parts = splitCommand(input);

  if (parts.length !== 2) {
    return { ok: false, error: getTaskMoveUsage() };
  }

  const [shortId, basketInput] = parts;
  const basket = parseTaskBasket(basketInput);

  if (!shortId) {
    return { ok: false, error: "Потрібен короткий id задачі." };
  }

  if (!basket) {
    return { ok: false, error: `Не знаю такого кошика: ${basketInput}\n\n${getTaskMoveUsage()}` };
  }

  return {
    ok: true,
    value: {
      shortId,
      basket,
    },
  };
}

export function parseTaskBasket(input: string): TaskBasket | undefined {
  const normalized = input.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  const aliases: Record<string, TaskBasket> = {
    "911": "911",
    urgent: "911",
    терміново: "911",
    операційка: "operational",
    операційні: "operational",
    операційна: "operational",
    operational: "operational",
    ops: "operational",
    deep: "deep_work",
    deep_work: "deep_work",
    глибока_робота: "deep_work",
    фокус: "deep_work",
    focus: "deep_work",
    random: "random",
    рандом: "random",
    бренд: "personal_brand",
    personal_brand: "personal_brand",
    особистий_бренд: "personal_brand",
    персональний_бренд: "personal_brand",
    brand: "personal_brand",
    other: "other",
    інше: "other",
    інші: "other",
  };

  return aliases[normalized] ?? taskBaskets.find((basket) => basket === normalized);
}

export function parseParticipant(input: string): Participant | undefined {
  const normalized = input.trim().toLowerCase();
  const aliases: Record<string, Participant> = {
    vania: "vania",
    vanya: "vania",
    ivan: "vania",
    ваня: "vania",
    мені: "vania",
    nastia: "nastia",
    nastya: "nastia",
    настя: "nastia",
    насті: "nastia",
    both: "both",
    разом: "both",
  };

  return aliases[normalized] ?? participants.find((participant) => participant === normalized);
}

export function parseTaskPriority(input: string): TaskPriority | undefined {
  const normalized = input.trim().toUpperCase();

  return taskPriorities.find((priority) => priority === normalized);
}

function splitCommand(input: string): string[] {
  return input.split("|").map((part) => part.trim()).filter(Boolean);
}
