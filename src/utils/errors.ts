export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

export type ServiceError = { message: string; timestamp: string };

export function buildServiceError(message?: string | null): ServiceError | null {
  if (!message) {
    return null;
  }
  return { message, timestamp: new Date().toISOString() };
}
