import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isIsoDate } from "@/lib/date";

export const runtime = "nodejs";

const PostSchema = z.object({
  date: z.string().min(1),
  startMin: z.number().int().min(0).max(24 * 60),
  endMin: z.number().int().min(0).max(24 * 60),
});

function isIsoMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "ROOKIE") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  if (!month || !isIsoMonth(month)) return NextResponse.json({ error: "INVALID_MONTH" }, { status: 400 });

  const bookings = await prisma.rookieBooking.findMany({
    where: { storeId: user.storeId, rookieId: user.id, date: { startsWith: `${month}-` } },
    select: { id: true, date: true, startMin: true, endMin: true },
    orderBy: [{ date: "asc" }, { startMin: "asc" }],
  });

  return NextResponse.json({ bookings });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "ROOKIE") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isIsoDate(parsed.data.date)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  if (parsed.data.endMin <= parsed.data.startMin) return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });

  const booking = await prisma.rookieBooking.create({
    data: { storeId: user.storeId, rookieId: user.id, date: parsed.data.date, startMin: parsed.data.startMin, endMin: parsed.data.endMin },
    select: { id: true, date: true, startMin: true, endMin: true },
  });

  return NextResponse.json({ booking });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "ROOKIE") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });

  await prisma.rookieBooking.deleteMany({ where: { id, storeId: user.storeId, rookieId: user.id } });
  return NextResponse.json({ ok: true });
}
