let commandCount = 0;

export function incrementCommandCount(): void {
  commandCount += 1;
}

export function getCommandCount(): number {
  return commandCount;
}
