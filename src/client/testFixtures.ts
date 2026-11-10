import type { StoryView } from "../shared/api";

export const ME = "p-me";
export const OTHER = "p-other";
export const THIRD = "p-third";

const NAMES: { [participantId: string]: string } = { [ME]: "Me", [OTHER]: "Sam", [THIRD]: "Kim" };

interface ViewOptions {
  /** Participant IDs in turn order. */
  participants: readonly string[];
  /** Null for a waiting story. */
  holderId: string | null;
  /** The participant who wrote the most recent passage. */
  lastWriterId: string;
  version?: number;
}

/** The user behind a participant. A passage names its author by user, not by participant. */
export function userIdOf(participantId: string): string {
  return `u-${participantId}`;
}

/** A story view as `me` (ME) sees it. */
export function storyView({
  participants,
  holderId,
  lastWriterId,
  version = 3,
}: ViewOptions): StoryView {
  const passages = [
    {
      id: "c1",
      authorId: userIdOf(lastWriterId),
      authorName: NAMES[lastWriterId] ?? "?",
      text: "Once upon a time.",
      startsParagraph: true,
      createdAt: 1,
    },
  ];
  const people = participants.map((id) => ({
    id,
    userId: userIdOf(id),
    displayName: NAMES[id] ?? "?",
  }));

  return {
    passages,
    participants: people,
    me: ME,
    turn:
      holderId === null
        ? { holderId: null, endsAt: null, version }
        : { holderId, endsAt: Date.now() + 3_600_000, version },
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}
