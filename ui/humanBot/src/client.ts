/** Bounded browser RPC. Abort terminates the worker, so queued/stale work cannot commit. */
export class BotWorkerClient {
  private readonly waiting = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
  >();
  private dead = false;
  constructor(private readonly worker: Worker) {
    worker.onmessage = event => {
      const reply = event.data as { id: string; ok: boolean; value?: unknown; error?: string };
      const request = this.waiting.get(reply.id);
      if (!request) return;
      this.waiting.delete(reply.id);
      request.cleanup();
      if (reply.ok) request.resolve(reply.value);
      else request.reject(new Error(reply.error ?? 'Worker request failed'));
    };
    worker.onerror = event => {
      this.close(new Error(event.message));
    };
    worker.onmessageerror = () => {
      this.close(new Error('Invalid worker response'));
    };
  }
  call<T>(
    command: { id: string; kind: string; [key: string]: unknown },
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (this.dead) return Promise.reject(new Error('Bot worker is closed'));
    if (this.waiting.has(command.id)) return Promise.reject(new Error('Duplicate in-flight request id'));
    if (options.signal?.aborted) return Promise.reject(new Error('Bot request aborted'));
    if (this.waiting.size >= 8) return Promise.reject(new Error('Bot worker queue is full'));
    const timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000)
      return Promise.reject(new Error('Invalid worker timeout'));
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.close(new Error('Bot request aborted; restore the last saved session in a new worker'));
      };
      const timeout = setTimeout(() => this.close(new Error('Bot worker runtime limit exceeded')), timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.waiting.set(command.id, { resolve: value => resolve(value as T), reject, cleanup });
      try {
        this.worker.postMessage(command);
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  close(reason: Error = new Error('Bot worker closed')): void {
    if (this.dead) return;
    this.dead = true;
    this.worker.terminate();
    for (const request of this.waiting.values()) {
      request.cleanup();
      request.reject(reason);
    }
    this.waiting.clear();
  }
}
