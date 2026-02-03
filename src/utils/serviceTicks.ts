export type ServiceTickState = {
  isTicking: boolean;
  setTicking: (value: boolean) => void;
  setLastTickAt: (value: string) => void;
};

export function beginServiceTick(state: ServiceTickState): (() => void) | null {
  if (state.isTicking) {
    return null;
  }
  state.setTicking(true);
  state.setLastTickAt(new Date().toISOString());
  return () => state.setTicking(false);
}
