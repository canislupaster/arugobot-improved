export class CooldownManager {
  private userCooldowns = new Map<string, number>();
  private lastGlobal = 0;

  constructor(private userCooldownSeconds: number, private globalCooldownSeconds: number) {}

  isAllowed(userId: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now() / 1000;
    const lastUser = this.userCooldowns.get(userId);
    if (lastUser && now - lastUser < this.userCooldownSeconds) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(this.userCooldownSeconds - (now - lastUser)),
      };
    }

    if (now < this.lastGlobal + this.globalCooldownSeconds) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(this.lastGlobal + this.globalCooldownSeconds - now),
      };
    }

    this.userCooldowns.set(userId, now);
    this.lastGlobal = now;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
