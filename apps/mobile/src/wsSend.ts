import type { ClientEvent } from "@mapp/protocol";

/**
 * Indirection so stores can send socket events without importing the
 * Realtime singleton, which itself imports the stores to dispatch events.
 */
let sender: ((event: ClientEvent) => boolean) | null = null;

export function setSocketSender(fn: (event: ClientEvent) => boolean): void {
  sender = fn;
}

export function sendSocketEvent(event: ClientEvent): boolean {
  return sender ? sender(event) : false;
}
