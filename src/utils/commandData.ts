type CommandOptionLike = {
  name?: string;
  required?: boolean;
  options?: CommandOptionLike[];
};

type CommandDataLike = {
  name?: string;
  options?: CommandOptionLike[];
};

export type CommandOptionOrderIssue = {
  path: string;
  optionName: string;
};

function normalizeCommandOptions<T extends CommandOptionLike>(options: T[]): T[] {
  let needsReorder = false;
  let seenOptional = false;
  const normalized = options.map((option) => {
    const nestedOptions = option.options
      ? (normalizeCommandOptions(option.options as T[]) as CommandOptionLike[])
      : undefined;
    const next = nestedOptions ? { ...option, options: nestedOptions } : option;
    const required = Boolean(next.required);
    if (!required) {
      seenOptional = true;
    } else if (seenOptional) {
      needsReorder = true;
    }
    return next as T;
  });
  if (!needsReorder) {
    return normalized;
  }
  const requiredOptions = normalized.filter((option) => option.required);
  const optionalOptions = normalized.filter((option) => !option.required);
  return [...requiredOptions, ...optionalOptions];
}

export function normalizeCommandData<T extends CommandDataLike>(data: T): T {
  if (!data.options) {
    return data;
  }
  return { ...data, options: normalizeCommandOptions(data.options) } as T;
}

function buildOptionPath(path: string[]): string {
  return path.filter(Boolean).join(" > ");
}

function collectOrderIssues(
  options: CommandOptionLike[] | undefined,
  path: string[],
  issues: CommandOptionOrderIssue[]
): void {
  if (!options || options.length === 0) {
    return;
  }
  let seenOptional = false;
  for (const option of options) {
    const required = Boolean(option.required);
    if (!required) {
      seenOptional = true;
    } else if (seenOptional) {
      issues.push({
        path: buildOptionPath(path),
        optionName: option.name ?? "unknown",
      });
    }
    if (option.options && option.options.length > 0) {
      collectOrderIssues(option.options, [...path, option.name ?? "unknown"], issues);
    }
  }
}

export function findCommandOptionOrderIssues<T extends CommandDataLike>(
  data: T
): CommandOptionOrderIssue[] {
  const issues: CommandOptionOrderIssue[] = [];
  const rootName = data.name ?? "command";
  collectOrderIssues(data.options, [rootName], issues);
  return issues;
}
