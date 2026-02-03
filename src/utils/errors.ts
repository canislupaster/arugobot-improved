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

export function getErrorMessageForLog(error: unknown): string {
  return getErrorMessage(error) || String(error);
}

export function buildServiceErrorFromException(error: unknown): ServiceError {
  return {
    message: getErrorMessageForLog(error),
    timestamp: new Date().toISOString(),
  };
}

export function recordServiceError(
  error: unknown,
  record: (serviceError: ServiceError) => void
): ServiceError {
  const serviceError = buildServiceErrorFromException(error);
  record(serviceError);
  return serviceError;
}

export function recordServiceErrorMessage(
  error: unknown,
  record: (serviceError: ServiceError) => void
): string {
  return recordServiceError(error, record).message;
}
