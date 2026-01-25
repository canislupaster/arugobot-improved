import { serve, type ServerType } from "@hono/node-server";
import type { Client } from "discord.js";

import type { WebsiteService } from "../services/website.js";
import { logError, logInfo } from "../utils/logger.js";

import { createWebApp } from "./app.js";

export type WebServerConfig = {
  host: string;
  port: number;
};

export function startWebServer(
  config: WebServerConfig,
  deps: { website: WebsiteService; client: Client }
): ServerType | null {
  const app = createWebApp(deps);
  try {
    const server = serve({
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    });
    server.on("error", (error) => {
      const err = error as NodeJS.ErrnoException;
      logError("Web server error.", {
        host: config.host,
        port: config.port,
        code: err.code ?? "unknown",
        message: err.message,
      });
    });
    logInfo("Web server started.", { host: config.host, port: config.port });
    return server;
  } catch (error) {
    logError("Web server failed to start.", {
      host: config.host,
      port: config.port,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
