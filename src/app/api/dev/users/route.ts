import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "true") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, displayName: true, role: true, storeId: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });

  return NextResponse.json({ users });
}
