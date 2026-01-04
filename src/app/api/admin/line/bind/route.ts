import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const BodySchema = z.object({
  userId: z.string().min(1),
  lineUserId: z.string().min(1),
});

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!requireRole(me, ["MANAGER"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const target = await prisma.user.findFirst({
    where: { id: parsed.data.userId, storeId: me.storeId, active: true },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { lineUserId: parsed.data.lineUserId },
    select: { id: true, lineUserId: true },
  });

  const cookieStore = await cookies();
  cookieStore.set("pending_line_user_id", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });

  return NextResponse.json({ user: updated });
}

