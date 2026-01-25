import { createAdaptorServer, type ServerType } from "@hono/node-server";
import type { Client } from "discord.js";

import type { WebsiteService } from "../services/website.js";
import type { WebServerStatus } from "../types/webStatus.js";
import { logError, logInfo, logWarn } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

import { createWebApp } from "./app.js";

export type WebServerConfig = {
  host: string;
  port: number;
};

type ListenResult = {
  server: ServerType | null;
  actualPort: number | null;
  error: NodeJS.ErrnoException | null;
  port: number;
};

function formatWebServerErrorMessage(
  host: string,
  port: number,
  error: NodeJS.ErrnoException
): string {
  if (error.code === "EADDRINUSE") {
    return `Web server port ${port} is already in use on ${host}. Choose another port.`;
  }
  return error.message ?? "Unknown web server error.";
}

export async function startWebServer(
  config: WebServerConfig,
  deps: { website: WebsiteService; client: Client },
  status?: WebServerStatus
): Promise<ServerType | null> {
  const app = createWebApp(deps);
  const maxAttempts = config.port === 0 ? 1 : 3;
  const retryDelayMs = 500;

  const updateFailure = (port: number, err: NodeJS.ErrnoException) => {
    const message = formatWebServerErrorMessage(config.host, port, err);
    if (status) {
      Object.assign(status, {
        status: "failed",
        actualPort: null,
        lastError: {
          message,
          code: err.code,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  const tryListen = async (port: number, attempts: number): Promise<ListenResult> => {
    let lastError: NodeJS.ErrnoException | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
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

        const handleListenError = (error: NodeJS.ErrnoException) => {
          logError("Web server error.", {
            host: config.host,
            port,
            code: error.code ?? "unknown",
            message: formatWebServerErrorMessage(config.host, port, error),
          });
          finalize({ server: null, actualPort: null, error });
        };

        server.on("error", (error) => {
          handleListenError(error as NodeJS.ErrnoException);
        });

        try {
          server.listen(port, config.host, () => {
            const address = server.address();
            const actualPort =
              typeof address === "object" && address ? Number(address.port) : port;
            logInfo("Web server started.", { host: config.host, port: actualPort });
            finalize({ server, actualPort, error: null });
          });
        } catch (error) {
          handleListenError(error as NodeJS.ErrnoException);
        }
      });

      if (server) {
        return { server, actualPort, error: null, port };
      }

      if (error && error.code === "EADDRINUSE" && attempt < attempts) {
        logWarn("Web server port already in use; retrying.", {
          host: config.host,
          port,
          attempt,
          remainingAttempts: attempts - attempt,
        });
        await sleep(retryDelayMs);
        continue;
      }

      lastError = error;
      break;
    }

    return { server: null, actualPort: null, error: lastError, port };
  };

  const result = await tryListen(config.port, maxAttempts);

  if (result.server) {
    if (status) {
      status.status = "listening";
      status.actualPort = result.actualPort;
      status.lastError = null;
    }
    return result.server;
  }

  if (result.error) {
    updateFailure(result.port, result.error);
  }

  return null;
}
