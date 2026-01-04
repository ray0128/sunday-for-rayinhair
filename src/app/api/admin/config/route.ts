import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const PutSchema = z.object({
  key: z.string().min(1),
  value: z.any(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!requireRole(user, ["MANAGER"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const configs = await prisma.config.findMany({
    where: { storeId: user.storeId, effectiveFrom: null },
    select: { id: true, key: true, valueJson: true },
    orderBy: { key: "asc" },
  });

  return NextResponse.json({ configs });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!requireRole(user, ["MANAGER"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const existing = await prisma.config.findFirst({
    where: { storeId: user.storeId, key: parsed.data.key, effectiveFrom: null },
    select: { id: true },
  });

  const valueJson = JSON.stringify({ value: parsed.data.value });

  const config = existing
    ? await prisma.config.update({
        where: { id: existing.id },
        data: { valueJson },
        select: { id: true, key: true, valueJson: true },
      })
    : await prisma.config.create({
        data: { storeId: user.storeId, key: parsed.data.key, valueJson, effectiveFrom: null, effectiveTo: null },
        select: { id: true, key: true, valueJson: true },
      });

  return NextResponse.json({ config });
}
