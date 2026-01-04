import { prisma } from "@/lib/prisma";

export type ConfigValue =
  | { value: string }
  | { value: number }
  | { value: boolean }
  | { value: null }
  | { value: unknown };

function hasValue(obj: unknown): obj is { value: unknown } {
  return typeof obj === "object" && obj !== null && "value" in obj;
}

export async function getConfigValue(storeId: string, key: string) {
  const row = await prisma.config.findFirst({
    where: { storeId, key, effectiveFrom: null },
    select: { valueJson: true },
  });
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.valueJson);
    if (!hasValue(parsed)) return null;
    return parsed as ConfigValue;
  } catch {
    return null;
  }
}

export async function getNumberConfig(storeId: string, key: string, fallback: number) {
  const v = await getConfigValue(storeId, key);
  if (!v || typeof v.value !== "number") return fallback;
  return v.value;
}

export async function getBooleanConfig(storeId: string, key: string, fallback: boolean) {
  const v = await getConfigValue(storeId, key);
  if (!v || typeof v.value !== "boolean") return fallback;
  return v.value;
}

export async function getStringConfig(storeId: string, key: string, fallback: string) {
  const v = await getConfigValue(storeId, key);
  if (!v || typeof v.value !== "string") return fallback;
  return v.value;
}
