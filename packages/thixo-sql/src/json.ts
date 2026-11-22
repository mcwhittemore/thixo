export function encodeValue(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, current: unknown) {
    const original = this[key];
    if (original instanceof Date) {
      if (Number.isNaN(original.getTime())) throw new RangeError("Cannot store an invalid date");
      return { $date: original.toISOString() };
    }
    return current;
  });
}

export function decodeValue(text: string): unknown {
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "$date" && typeof value.$date === "string") return new Date(value.$date);
    }
    return value;
  });
}
