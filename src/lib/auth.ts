import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export type Role = "DESIGNER" | "ASSISTANT" | "ROOKIE" | "MANAGER";

export type AuthUser = {
  id: string;
  storeId: string;
  role: Role;
  displayName: string;
  lineUserId: string | null;
};

export async function getCurrentUser(): Promise<AuthUser | null> {
  const h = await headers();
  const fromHeader = h.get("x-mock-user-id");
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get("mock_user_id")?.value;
  const userId = fromHeader ?? fromCookie;
  if (!userId) return null;

  const user = await prisma.user.findFirst({
    where: { id: userId, active: true },
    select: { id: true, storeId: true, role: true, displayName: true, lineUserId: true },
  });
  return user ?? null;
}

export function requireRole(user: AuthUser | null, allowed: Role[]) {
  if (!user) return false;
  return allowed.includes(user.role);
}
