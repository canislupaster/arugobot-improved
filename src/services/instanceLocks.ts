import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";

export type InstanceLock = {
  name: string;
  ownerId: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
};

export type InstanceLockResult = {
  acquired: boolean;
  lock: InstanceLock | null;
};

export class InstanceLockService {
  constructor(private readonly db: Kysely<Database>) {}

  async acquireLock(name: string, ownerId: string, pid: number, ttlSeconds: number) {
    const nowIso = new Date().toISOString();
    const staleBefore = new Date(Date.now() - ttlSeconds * 1000).toISOString();

    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("instance_locks")
        .select(["name", "owner_id", "pid", "started_at", "heartbeat_at"])
        .where("name", "=", name)
        .executeTakeFirst();

      if (!existing) {
        await trx
          .insertInto("instance_locks")
          .values({
            name,
            owner_id: ownerId,
            pid,
            started_at: nowIso,
            heartbeat_at: nowIso,
          })
          .execute();
        return {
          acquired: true,
          lock: this.toLock({
            name,
            ownerId,
            pid,
            startedAt: nowIso,
            heartbeatAt: nowIso,
          }),
        };
      }

      if (existing.owner_id === ownerId) {
        await trx
          .updateTable("instance_locks")
          .set({ heartbeat_at: nowIso, pid })
          .where("name", "=", name)
          .where("owner_id", "=", ownerId)
          .execute();
        return {
          acquired: true,
          lock: this.toLock({
            name,
            ownerId,
            pid,
            startedAt: existing.started_at,
            heartbeatAt: nowIso,
          }),
        };
      }

      if (existing.heartbeat_at <= staleBefore) {
        await trx
          .updateTable("instance_locks")
          .set({
            owner_id: ownerId,
            pid,
            started_at: nowIso,
            heartbeat_at: nowIso,
          })
          .where("name", "=", name)
          .execute();
        return {
          acquired: true,
          lock: this.toLock({
            name,
            ownerId,
            pid,
            startedAt: nowIso,
            heartbeatAt: nowIso,
          }),
        };
      }

      return { acquired: false, lock: this.fromRow(existing) };
    });
  }

  async heartbeat(name: string, ownerId: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const result = await this.db
      .updateTable("instance_locks")
      .set({ heartbeat_at: nowIso })
      .where("name", "=", name)
      .where("owner_id", "=", ownerId)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0) > 0;
  }

  async release(name: string, ownerId: string): Promise<void> {
    await this.db
      .deleteFrom("instance_locks")
      .where("name", "=", name)
      .where("owner_id", "=", ownerId)
      .execute();
  }

  async getLock(name: string): Promise<InstanceLock | null> {
    const row = await this.db
      .selectFrom("instance_locks")
      .select(["name", "owner_id", "pid", "started_at", "heartbeat_at"])
      .where("name", "=", name)
      .executeTakeFirst();
    return row ? this.fromRow(row) : null;
  }

  private toLock(input: {
    name: string;
    ownerId: string;
    pid: number;
    startedAt: string;
    heartbeatAt: string;
  }) {
    return {
      name: input.name,
      ownerId: input.ownerId,
      pid: input.pid,
      startedAt: input.startedAt,
      heartbeatAt: input.heartbeatAt,
    };
  }

  private fromRow(row: {
    name: string;
    owner_id: string;
    pid: number;
    started_at: string;
    heartbeat_at: string;
  }): InstanceLock {
    return {
      name: row.name,
      ownerId: row.owner_id,
      pid: row.pid,
      startedAt: row.started_at,
      heartbeatAt: row.heartbeat_at,
    };
  }
}
