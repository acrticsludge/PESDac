import { auth } from "../../../../../lib/auth";
import type { APIRoute } from "astro";

export const prerender = false;

// Astro dispatches by exported method name — `ALL` is not a handler, so
// every auth call 404d. One shared handler, explicitly exported per method.
const handler: APIRoute = ({ request }) => auth.handler(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
