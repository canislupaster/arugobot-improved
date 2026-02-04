export type ServiceTickState = {
  getIsTicking: () => boolean;
  setTicking: (value: boolean) => void;
  setLastTickAt: (value: string) => void;
};

export type ServiceTickError = { message: string; timestamp: string };

export type ServiceTickTracker = {
  getLastTickAt: () => string | null;
  getLastError: () => ServiceTickError | null;
  setLastError: (value: ServiceTickError | null) => void;
  tickState: ServiceTickState;
};

export type AsyncTaskTracker = {
  track: <T>(promise: Promise<T>) => Promise<T>;
  waitForIdle: (timeoutMs: number) => Promise<{ status: "idle" | "timeout"; pending: number }>;
  getPendingCount: () => number;
};

export function createServiceTickState(
  getIsTicking: () => boolean,
  setTicking: (value: boolean) => void,
  setLastTickAt: (value: string) => void
): ServiceTickState {
  return {
    getIsTicking,
    setTicking,
    setLastTickAt,
  };
}

export function createServiceTickTracker(): ServiceTickTracker {
  let isTicking = false;
  let lastTickAt: string | null = null;
  let lastError: ServiceTickError | null = null;
  const tickState = createServiceTickState(
    () => isTicking,
    (value) => {
      isTicking = value;
    },
    (value) => {
      lastTickAt = value;
    }
  );

  return {
    getLastTickAt: () => lastTickAt,
    getLastError: () => lastError,
    setLastError: (value) => {
      lastError = value;
    },
    tickState,
  };
}

export function createAsyncTaskTracker(): AsyncTaskTracker {
  const pending = new Set<Promise<unknown>>();
  return {
    track: (promise) => {
      pending.add(promise);
      promise.finally(() => pending.delete(promise));
      return promise;
    },
    waitForIdle: async (timeoutMs) => {
      if (pending.size === 0) {
        return { status: "idle", pending: 0 };
      }
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeout = new Promise<{ status: "timeout"; pending: number }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ status: "timeout", pending: pending.size }), timeoutMs);
      });
      const idle = Promise.allSettled(Array.from(pending)).then(() => ({
        status: "idle" as const,
        pending: 0,
      }));
      const result = await Promise.race([idle, timeout]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      return result;
    },
    getPendingCount: () => pending.size,
  };
}

export function beginServiceTick(state: ServiceTickState): (() => void) | null {
  if (state.getIsTicking()) {
    return null;
  }
  state.setTicking(true);
  state.setLastTickAt(new Date().toISOString());
  return () => state.setTicking(false);
}

export async function runServiceTick(
  state: ServiceTickState,
  handler: () => Promise<void>
): Promise<boolean> {
  const finish = beginServiceTick(state);
  if (!finish) {
    return false;
  }
  try {
    await handler();
  } finally {
    finish();
  }
  return true;
}
