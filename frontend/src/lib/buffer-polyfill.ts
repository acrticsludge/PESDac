// Minimal Buffer polyfill for browser compatibility.
export class Buffer {
  static from(str: string): Buffer {
    return new Buffer(str);
  }
  static isBuffer(obj: unknown): boolean {
    return obj instanceof Buffer;
  }
  static byteLength(str: string): number {
    return new TextEncoder().encode(str || "").length;
  }
  constructor(public value: string) {}
  toString(): string {
    return this.value || "";
  }
}

// The browser bundle needs a small Buffer surface for Better Auth's client
// dependencies, but Astro SSR must keep Node's native Buffer intact. Replacing
// it on the server breaks Astro's renderer (for example Buffer.concat).
if (
  typeof window !== "undefined" &&
  typeof globalThis !== "undefined" &&
  !(globalThis as Record<string, unknown>).Buffer
) {
  const g = globalThis as Record<string, unknown>;
  g.Buffer = Buffer;
}
