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
