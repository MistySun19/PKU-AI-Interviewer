import type { SseEvent } from "./types";

export type EventChannel = {
  emit: (event: SseEvent) => void;
  close: () => void;
  fail: (error: unknown) => void;
  iterate: () => AsyncGenerator<SseEvent>;
};

export function createEventChannel(): EventChannel {
  const queue: SseEvent[] = [];
  let notify: (() => void) | null = null;
  let closed = false;
  let failure: unknown = null;

  const wake = () => {
    notify?.();
    notify = null;
  };

  return {
    emit(event) {
      if (closed) return;
      queue.push(event);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    fail(error) {
      failure = error;
      closed = true;
      wake();
    },
    async *iterate() {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
        if (closed) return;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    }
  };
}
