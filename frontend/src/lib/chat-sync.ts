// Chat persistence sync client (spec §4 — Stream B).
// Thin `apiFetch` wrappers ONLY: path join, method, body, response mapping.
// No caching, no identity logic, no retry, no toasts — errors propagate as
// `ApiError` (surfacing is stream C's job). Callers pass bare paths; the
// `/api/v1` prefix is joined inside `apiFetch`.
import { apiFetch } from "./auth.ts";

/** Server chat container row (backend `ChatOut`). Timestamps are ISO strings. */
export type ServerChat = {
  code: string;
  subject: string;
  title: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  // Lean-list columns (migration 0007, Stream A). Optional: rows served
  // from branches without the migration omit them — callers fall back to
  // title-only rows + full-window loads (spec §13), never stubbed data.
  preview?: string;
  msgCount?: number;
  lastSeq?: number;
};

/** Server message row (backend `MessageOut`). `seq` is server-assigned. */
export type ServerMessage = {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system";
  content: unknown;
  createdAt: string;
};

/** List envelope shared by the chats/messages list + delete-all endpoints. */
export type ListEnvelope<T> = {
  data: T;
  pagination: { limit: number; offset: number; total: number };
};

/** Server-side list filters (spec FR2/FR3). Omitted/blank keys send nothing. */
export type ChatListQuery = {
  archived?: boolean;
  subject?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

/** Windowed message reads (spec FR2): open `limit=50, offset=max(0,total-50)`. */
export type MessagePageQuery = {
  limit?: number;
  offset?: number;
};

function encodeQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const trimmed = typeof value === "string" ? value.trim() : value;
    if (typeof trimmed === "string" && trimmed === "") continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(trimmed))}`,
    );
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function chatPath(code: string): string {
  return `/chats/${encodeURIComponent(code)}`;
}

function messagesPath(code: string): string {
  return `/chats/${encodeURIComponent(code)}/messages`;
}

/** List owned chat containers (server wins; replaces memory customs). */
export async function apiListChats(
  query?: ChatListQuery,
): Promise<ServerChat[]> {
  return (await apiListChatsPage(query)).data;
}

/** Same list leg with the `{data, pagination}` envelope (counts/windowing). */
export async function apiListChatsPage(
  query?: ChatListQuery,
): Promise<ListEnvelope<ServerChat[]>> {
  const qs = encodeQuery({
    archived: query?.archived,
    subject: query?.subject,
    q: query?.q,
    limit: query?.limit,
    offset: query?.offset,
  });
  return apiFetch<ListEnvelope<ServerChat[]>>(`/chats${qs}`);
}

/** Create a chat container. `clientAdoptKey` is the adopt-idempotency key
 *  (caching Phase 5, spec §10.2): sent only by the guest→login adopt path,
 *  one UUID per guest chat. Ordinary creates omit it and behave as before. */
export async function apiCreateChat(
  subject: string,
  title: string,
  opts?: { clientAdoptKey?: string },
): Promise<ServerChat> {
  return apiFetch<ServerChat>("/chats", {
    method: "POST",
    body:
      opts?.clientAdoptKey != null
        ? { subject, title, clientAdoptKey: opts.clientAdoptKey }
        : { subject, title },
  });
}

/** Patch title / pin / archive flags on one chat. */
export async function apiPatchChat(
  code: string,
  patch: { title?: string; isPinned?: boolean; isArchived?: boolean },
): Promise<ServerChat> {
  return apiFetch<ServerChat>(chatPath(code), {
    method: "PATCH",
    body: patch,
  });
}

/** Delete one chat (204, empty body — never `res.json()` a 204). */
export async function apiDeleteChat(code: string): Promise<void> {
  await apiFetch<void>(chatPath(code), { method: "DELETE" });
}

/** Delete-all owned chats; `deleted` counts the purged containers. */
export async function apiClearChats(): Promise<{ deleted: number }> {
  const res = await apiFetch<ListEnvelope<{ deleted: number }>>("/chats", {
    method: "DELETE",
  });
  return res.data;
}

/** List a chat's messages ascending by `seq` (returns the `data` array). */
export async function apiListMessages(
  code: string,
  query?: MessagePageQuery,
): Promise<ServerMessage[]> {
  return (await apiListMessagesPage(code, query)).data;
}

/** Same messages leg with the `{data, pagination}` envelope (windowing). */
export async function apiListMessagesPage(
  code: string,
  query?: MessagePageQuery,
): Promise<ListEnvelope<ServerMessage[]>> {
  const qs = encodeQuery({ limit: query?.limit, offset: query?.offset });
  return apiFetch<ListEnvelope<ServerMessage[]>>(`${messagesPath(code)}${qs}`);
}

/** Append one turn (`seq` assigned server-side).
 *  `clientMsgKey` is the append-idempotency key (Phase 5 T5a): the
 *  outbox flush replays with the SAME key so a retry after a dropped
 *  connection returns the original row (200) instead of duplicating.
 *  Optional — appends omitting it behave exactly as before. */
export async function apiAppendMessage(
  code: string,
  m: { role: "user" | "assistant" | "system"; content: unknown },
  opts?: { clientMsgKey?: string },
): Promise<ServerMessage> {
  return apiFetch<ServerMessage>(messagesPath(code), {
    method: "POST",
    body:
      opts?.clientMsgKey != null
        ? { role: m.role, content: m.content, clientMsgKey: opts.clientMsgKey }
        : { role: m.role, content: m.content },
  });
}

/** Delete `seq >= fromSeq`; `deleted` counts the purged turns. */
export async function apiTruncateMessages(
  code: string,
  fromSeq: number,
): Promise<{ deleted: number }> {
  const res = await apiFetch<ListEnvelope<{ deleted: number }>>(
    `${messagesPath(code)}?from_seq=${encodeURIComponent(String(fromSeq))}`,
    { method: "DELETE" },
  );
  return res.data;
}
