export type ServiceTickState = {
  getIsTicking: () => boolean;
  setTicking: (value: boolean) => void;
  setLastTickAt: (value: string) => void;
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
