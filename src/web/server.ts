import { serve, type ServerType } from "@hono/node-server";
import type { Client } from "discord.js";

import type { WebsiteService } from "../services/website.js";
import { logInfo } from "../utils/logger.js";

import { createWebApp } from "./app.js";

export type WebServerConfig = {
  host: string;
  port: number;
};

export function startWebServer(
  config: WebServerConfig,
  deps: { website: WebsiteService; client: Client }
): ServerType {
  const app = createWebApp(deps);
  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });
  logInfo("Web server started.", { host: config.host, port: config.port });
  return server;
}
