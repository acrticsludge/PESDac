// Minimal events polyfill for browser compatibility.
export class EventEmitter {
  private listeners: Record<string, Array<(data?: unknown) => void>> = {};
  on(event: string, listener: (data?: unknown) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }
  emit(event: string, data?: unknown) {
    (this.listeners[event] || []).forEach((l) => l(data));
  }
}
export default EventEmitter;
