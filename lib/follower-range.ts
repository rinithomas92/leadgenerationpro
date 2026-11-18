export function followerRange(minimum: string, maximum: string) {
  const parse = (value: string) => {
    if (!value.trim()) return undefined;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error("Follower limits must be whole numbers of zero or more.");
    return number;
  };
  const min = parse(minimum), max = parse(maximum);
  if (min !== undefined && max !== undefined && min > max) throw new Error("Minimum followers cannot exceed maximum followers.");
  return { min, max, active: min !== undefined || max !== undefined };
}
export function withinFollowerRange(count: unknown, range: ReturnType<typeof followerRange>) {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count >= (range.min ?? 0) && count <= (range.max ?? Infinity);
}
