import { createAdaptorServer, type ServerType } from "@hono/node-server";
import type { Client } from "discord.js";

import type { WebsiteService } from "../services/website.js";
import { logError, logInfo } from "../utils/logger.js";

import { createWebApp } from "./app.js";

export type WebServerConfig = {
  host: string;
  port: number;
};

export async function startWebServer(
  config: WebServerConfig,
  deps: { website: WebsiteService; client: Client }
): Promise<ServerType | null> {
  const app = createWebApp(deps);
  const server = createAdaptorServer({
    fetch: app.fetch,
    hostname: config.host,
  });

  return await new Promise((resolve) => {
    let resolved = false;
    const finalize = (value: ServerType | null) => {
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
      finalize(null);
    });

    try {
      server.listen(config.port, config.host, () => {
        logInfo("Web server started.", { host: config.host, port: config.port });
        finalize(server);
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      logError("Web server error.", {
        host: config.host,
        port: config.port,
        code: err.code ?? "unknown",
        message: err.message ?? String(error),
      });
      finalize(null);
    }
  });
}
