import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMonthAvailability } from "@/lib/quota";

export const runtime = "nodejs";

function isIsoMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  if (!month || !isIsoMonth(month)) {
    return NextResponse.json({ error: "INVALID_MONTH" }, { status: 400 });
  }

  const store = await prisma.store.findFirst({
    where: { id: user.storeId },
    select: { id: true, timezone: true },
  });
  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

  const result = await getMonthAvailability({
    storeId: store.id,
    storeTimeZone: store.timezone,
    month,
    requester: { userId: user.id, role: user.role },
  });

  return NextResponse.json(result);
}
