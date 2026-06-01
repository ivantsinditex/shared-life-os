import { participants, type Participant } from "./planned-activity.js";
import { taskBaskets, type TaskBasket } from "./task.js";

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ParsedTaskAdd = {
  title: string;
  basket: TaskBasket;
  participant?: Participant;
};

export type ParsedTaskMove = {
  shortId: string;
  basket: TaskBasket;
};

export function getTaskAddUsage(): string {
  return [
    "Use:",
    "/task_add Title | basket | participant",
    "",
    "Example:",
    "/task_add Reply to urgent client | 911 | vania",
    "",
    `baskets: ${taskBaskets.join(", ")}`,
    `participants: ${participants.join(", ")} (optional)`,
  ].join("\n");
}

export function getTaskMoveUsage(): string {
  return [
    "Use:",
    "/task_move short_id | basket",
    "",
    "Example:",
    "/task_move ab12cd34 | deep_work",
    "",
    `baskets: ${taskBaskets.join(", ")}`,
  ].join("\n");
}

export function parseTaskAddCommand(input: string): ParseResult<ParsedTaskAdd> {
  const parts = splitCommand(input);

  if (parts.length < 2 || parts.length > 3) {
    return { ok: false, error: getTaskAddUsage() };
  }

  const [title, basketInput, participantInput] = parts;
  const basket = parseTaskBasket(basketInput);

  if (!title) {
    return { ok: false, error: "Task title is required." };
  }

  if (!basket) {
    return { ok: false, error: `Unknown basket: ${basketInput}\n\n${getTaskAddUsage()}` };
  }

  const participant = participantInput ? parseParticipant(participantInput) : undefined;

  if (participantInput && !participant) {
    return { ok: false, error: `Unknown participant: ${participantInput}` };
  }

  return {
    ok: true,
    value: {
      title,
      basket,
      participant,
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
    return { ok: false, error: "Task short id is required." };
  }

  if (!basket) {
    return { ok: false, error: `Unknown basket: ${basketInput}\n\n${getTaskMoveUsage()}` };
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
    focus: "deep_work",
    random: "random",
    рандом: "random",
    бренд: "personal_brand",
    personal_brand: "personal_brand",
    brand: "personal_brand",
    other: "other",
    інше: "other",
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

function splitCommand(input: string): string[] {
  return input.split("|").map((part) => part.trim()).filter(Boolean);
}
