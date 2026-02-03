type CommandOptionLike = {
  required?: boolean;
  options?: CommandOptionLike[];
};

type CommandDataLike = {
  options?: CommandOptionLike[];
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
