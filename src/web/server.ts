import { createAdaptorServer, type ServerType } from "@hono/node-server";
import type { Client } from "discord.js";

import type { WebsiteService } from "../services/website.js";
import { sleep } from "../utils/sleep.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import type { WebServerStatus } from "../types/webStatus.js";

import { createWebApp } from "./app.js";

export type WebServerConfig = {
  host: string;
  port: number;
};

export async function startWebServer(
  config: WebServerConfig,
  deps: { website: WebsiteService; client: Client },
  status?: WebServerStatus
): Promise<ServerType | null> {
  const app = createWebApp(deps);
  const maxAttempts = config.port === 0 ? 1 : 3;
  const retryDelayMs = 500;

  const updateFailure = (err: NodeJS.ErrnoException) => {
    status &&
      Object.assign(status, {
        status: "failed",
        actualPort: null,
        lastError: {
          message: err.message ?? "Unknown error",
          code: err.code,
          timestamp: new Date().toISOString(),
        },
      });
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { server, actualPort, error } = await new Promise<{
      server: ServerType | null;
      actualPort: number | null;
      error: NodeJS.ErrnoException | null;
    }>((resolve) => {
      const server = createAdaptorServer({
        fetch: app.fetch,
        hostname: config.host,
      });
      let resolved = false;
      const finalize = (value: {
        server: ServerType | null;
        actualPort: number | null;
        error: NodeJS.ErrnoException | null;
      }) => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve(value);
      };

      server.on("error", (error) => {
        const err = error as NodeJS.ErrnoException;
        logError("Web server error.", {
          host: config.host,
          port: config.port,
          code: err.code ?? "unknown",
          message: err.message,
        });
        finalize({ server: null, actualPort: null, error: err });
      });

      try {
        server.listen(config.port, config.host, () => {
          const address = server.address();
          const actualPort =
            typeof address === "object" && address ? Number(address.port) : config.port;
          logInfo("Web server started.", { host: config.host, port: actualPort });
          finalize({ server, actualPort, error: null });
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        logError("Web server error.", {
          host: config.host,
          port: config.port,
          code: err.code ?? "unknown",
          message: err.message ?? String(error),
        });
        finalize({ server: null, actualPort: null, error: err });
      }
    });

    if (server) {
      if (status) {
        status.status = "listening";
        status.actualPort = actualPort;
        status.lastError = null;
      }
      return server;
    }

    if (error && error.code === "EADDRINUSE" && attempt < maxAttempts) {
      logWarn("Web server port already in use; retrying.", {
        host: config.host,
        port: config.port,
        attempt,
        remainingAttempts: maxAttempts - attempt,
      });
      await sleep(retryDelayMs);
      continue;
    }

    if (error) {
      updateFailure(error);
    }
    break;
  }

  return null;
}
