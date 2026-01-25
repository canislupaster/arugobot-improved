export type WebServerStatus = {
  status: "starting" | "listening" | "failed";
  host: string;
  requestedPort: number;
  actualPort: number | null;
  lastError: {
    message: string;
    code?: string;
    timestamp: string;
  } | null;
};
