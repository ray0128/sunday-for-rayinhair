import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const BodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "FORCE_APPROVE"]),
  reason: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!requireRole(user, ["MANAGER"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const lr = await prisma.leaveRequest.findFirst({
    where: { id, storeId: user.storeId },
    select: { id: true, status: true },
  });
  if (!lr) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (lr.status !== "PENDING") return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });

  const nextStatus = parsed.data.action === "REJECT" ? "REJECTED" : "APPROVED";

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.leaveRequest.update({
      where: { id },
      data: { status: nextStatus },
      select: { id: true, date: true, status: true, source: true, userId: true, linkedFrom: { select: { id: true } } },
    });

    await tx.approval.create({
      data: {
        storeId: user.storeId,
        leaveRequestId: id,
        managerId: user.id,
        action: parsed.data.action,
        reason: parsed.data.reason,
      },
    });

    if (updatedRequest.linkedFrom.length > 0) {
      const mirrorIds = updatedRequest.linkedFrom.map((x) => x.id);
      await tx.leaveRequest.updateMany({
        where: { id: { in: mirrorIds }, status: "PENDING" },
        data: { status: nextStatus },
      });
    }

    return updatedRequest;
  });

  return NextResponse.json({ leaveRequest: updated });
}
