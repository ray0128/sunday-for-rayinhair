import { NextResponse } from "next/server";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!requireRole(user, ["MANAGER"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const requests = await prisma.leaveRequest.findMany({
    where: { storeId: user.storeId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      date: true,
      status: true,
      source: true,
      createdAt: true,
      user: { select: { id: true, displayName: true, role: true } },
      linkedToId: true,
    },
  });

  return NextResponse.json({ requests });
}
