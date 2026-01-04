import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const BodySchema = z.object({
  userId: z.string().min(1),
});

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "true") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: { id: parsed.data.userId, active: true },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set("mock_user_id", user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
