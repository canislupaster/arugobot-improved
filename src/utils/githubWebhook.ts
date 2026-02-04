import { createHmac, timingSafeEqual } from "node:crypto";

export function computeGitHubSignature(secret: string, payload: string): string {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function verifyGitHubSignature(
  secret: string,
  payload: string,
  signature: string | undefined | null
): boolean {
  if (!signature) {
    return false;
  }
  const expected = computeGitHubSignature(secret, payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
