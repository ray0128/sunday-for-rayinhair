import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const PostSchema = z.object({
  assistantId: z.string().min(1),
  designerId: z.string().min(1),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!requireRole(user, ["MANAGER"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const bindings = await prisma.binding.findMany({
    where: { storeId: user.storeId, active: true },
    select: {
      id: true,
      assistant: { select: { id: true, displayName: true, role: true } },
      designer: { select: { id: true, displayName: true, role: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ bindings });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!requireRole(user, ["MANAGER"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const [assistant, designer] = await Promise.all([
    prisma.user.findFirst({ where: { id: parsed.data.assistantId, storeId: user.storeId, active: true }, select: { id: true, role: true } }),
    prisma.user.findFirst({ where: { id: parsed.data.designerId, storeId: user.storeId, active: true }, select: { id: true, role: true } }),
  ]);

  if (!assistant || assistant.role !== "ASSISTANT") return NextResponse.json({ error: "INVALID_ASSISTANT" }, { status: 400 });
  if (!designer || designer.role !== "DESIGNER") return NextResponse.json({ error: "INVALID_DESIGNER" }, { status: 400 });

  const binding = await prisma.binding.create({
    data: { storeId: user.storeId, assistantId: assistant.id, designerId: designer.id, active: true },
    select: { id: true },
  });

  return NextResponse.json({ binding });
}
