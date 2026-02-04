import { createAdaptorServer, type ServerType } from "@hono/node-server";
import type { Client } from "discord.js";

import type { GitHubIssueAutomationService } from "../services/githubIssueAutomation.js";
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
  deps: {
    website: WebsiteService;
    client: Client;
    githubAutomation?: GitHubIssueAutomationService;
    githubWebhookSecret?: string;
  },
  status?: WebServerStatus
): Promise<ServerType | null> {
  const app = createWebApp(deps);
  const maxAttempts = config.port === 0 ? 1 : 3;
  const retryDelayMs = 500;
  const portsToTry =
    config.port === 0
      ? [0]
      : Array.from({ length: maxAttempts }, (_, index) => config.port + index);

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

  const listenOnce = async (port: number): Promise<ListenResult> => {
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
          const actualPort = typeof address === "object" && address ? Number(address.port) : port;
          logInfo("Web server started.", { host: config.host, port: actualPort });
          finalize({ server, actualPort, error: null });
        });
      } catch (error) {
        handleListenError(error as NodeJS.ErrnoException);
      }
    });

    return { server, actualPort, error, port };
  };

  let lastError: NodeJS.ErrnoException | null = null;
  let lastPort = portsToTry[0];
  for (let index = 0; index < portsToTry.length; index += 1) {
    const port = portsToTry[index];
    const result = await listenOnce(port);
    lastPort = port;
    if (result.server) {
      if (status) {
        status.status = "listening";
        status.actualPort = result.actualPort;
        status.lastError = null;
      }
      return result.server;
    }

    lastError = result.error;
    if (lastError?.code === "EADDRINUSE") {
      if (index < portsToTry.length - 1) {
        logWarn("Web server port already in use; trying next.", {
          host: config.host,
          port,
          nextPort: portsToTry[index + 1],
        });
        await sleep(retryDelayMs);
        continue;
      }
    }
    if (lastError) {
      break;
    }
  }

  if (lastError?.code === "EADDRINUSE" && config.port !== 0) {
    logWarn("Web server ports busy; trying a random port.", {
      host: config.host,
      requestedPort: config.port,
    });
    const fallbackResult = await listenOnce(0);
    lastPort = fallbackResult.port;
    if (fallbackResult.server) {
      if (status) {
        status.status = "listening";
        status.actualPort = fallbackResult.actualPort;
        status.lastError = null;
      }
      return fallbackResult.server;
    }
    lastError = fallbackResult.error;
  }

  if (lastError) {
    updateFailure(lastPort, lastError);
  }

  return null;
}
