import type { ServiceTickTracker } from "../utils/serviceTicks.js";
import { createServiceTickTracker } from "../utils/serviceTicks.js";

export abstract class TickTrackedService {
  protected readonly tickTracker: ServiceTickTracker;

  protected constructor() {
    this.tickTracker = createServiceTickTracker();
  }

  getLastTickAt(): string | null {
    return this.tickTracker.getLastTickAt();
  }

  getLastError(): { message: string; timestamp: string } | null {
    return this.tickTracker.getLastError();
  }
}
