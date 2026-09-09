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
type ListEnvelope<T> = {
  data: T;
  pagination: { limit: number; offset: number; total: number };
};

function chatPath(code: string): string {
  return `/chats/${encodeURIComponent(code)}`;
}

function messagesPath(code: string): string {
  return `/chats/${encodeURIComponent(code)}/messages`;
}

/** List owned chat containers (server wins; replaces memory customs). */
export async function apiListChats(): Promise<ServerChat[]> {
  const res = await apiFetch<ListEnvelope<ServerChat[]>>("/chats");
  return res.data;
}

/** Create a chat container. */
export async function apiCreateChat(
  subject: string,
  title: string,
): Promise<ServerChat> {
  return apiFetch<ServerChat>("/chats", {
    method: "POST",
    body: { subject, title },
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
): Promise<ServerMessage[]> {
  const res = await apiFetch<ListEnvelope<ServerMessage[]>>(
    messagesPath(code),
  );
  return res.data;
}

/** Append one turn (`seq` assigned server-side). */
export async function apiAppendMessage(
  code: string,
  m: { role: "user" | "assistant" | "system"; content: unknown },
): Promise<ServerMessage> {
  return apiFetch<ServerMessage>(messagesPath(code), {
    method: "POST",
    body: { role: m.role, content: m.content },
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
