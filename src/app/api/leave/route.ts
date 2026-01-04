import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStringConfig } from "@/lib/config";
import { isIsoDate } from "@/lib/date";
import { getMonthAvailability } from "@/lib/quota";

export const runtime = "nodejs";

const BodySchema = z.object({
  date: z.string().min(1),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isIsoDate(parsed.data.date)) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  const date = parsed.data.date;
  const month = date.slice(0, 7);

  const existingAny = await prisma.leaveRequest.findFirst({
    where: { userId: user.id, date },
    select: { id: true, status: true },
  });
  if (existingAny && (existingAny.status === "PENDING" || existingAny.status === "APPROVED")) {
    return NextResponse.json({ error: "ALREADY_REQUESTED", status: existingAny.status }, { status: 409 });
  }

  const store = await prisma.store.findFirst({
    where: { id: user.storeId },
    select: { id: true, timezone: true },
  });
  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

  const availability = await getMonthAvailability({
    storeId: store.id,
    storeTimeZone: store.timezone,
    month,
    requester: { userId: user.id, role: user.role },
  });

  const day = availability.days.find((d) => d.date === date);
  if (!day) return NextResponse.json({ error: "DATE_OUT_OF_RANGE" }, { status: 400 });
  if (!day.selectable) {
    return NextResponse.json({ error: "NOT_ALLOWED", reasons: day.reasons }, { status: 403 });
  }

  const leaveRequest =
    existingAny && (existingAny.status === "CANCELED" || existingAny.status === "REJECTED")
      ? await prisma.leaveRequest.update({
          where: { id: existingAny.id },
          data: {
            status: "PENDING",
            source: "SELF",
            createdByUserId: user.id,
          },
          select: { id: true, date: true, status: true, source: true },
        })
      : await prisma.leaveRequest.create({
          data: {
            storeId: store.id,
            userId: user.id,
            date,
            status: "PENDING",
            source: "SELF",
            createdByUserId: user.id,
          },
          select: { id: true, date: true, status: true, source: true },
        });

  if (user.role === "DESIGNER") {
    const mirrorPolicy = await getStringConfig(store.id, "binding_mirror_leave", "auto_create");
    if (mirrorPolicy === "auto_create") {
      const bindings = await prisma.binding.findMany({
        where: { storeId: store.id, designerId: user.id, active: true },
        select: { assistantId: true },
      });

      for (const b of bindings) {
        const assistantExisting = await prisma.leaveRequest.findFirst({
          where: { userId: b.assistantId, date },
          select: { id: true, status: true },
        });
        if (assistantExisting && (assistantExisting.status === "PENDING" || assistantExisting.status === "APPROVED")) {
          continue;
        }

        if (assistantExisting && (assistantExisting.status === "CANCELED" || assistantExisting.status === "REJECTED")) {
          await prisma.leaveRequest.update({
            where: { id: assistantExisting.id },
            data: {
              status: "PENDING",
              source: "BINDING_MIRROR",
              createdByUserId: user.id,
              linkedToId: leaveRequest.id,
            },
          });
        } else {
          await prisma.leaveRequest.create({
            data: {
              storeId: store.id,
              userId: b.assistantId,
              date,
              status: "PENDING",
              source: "BINDING_MIRROR",
              createdByUserId: user.id,
              linkedToId: leaveRequest.id,
            },
          });
        }
      }
    }
  }

  return NextResponse.json({ leaveRequest });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isIsoDate(parsed.data.date)) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  const date = parsed.data.date;

  const existing = await prisma.leaveRequest.findFirst({
    where: { storeId: user.storeId, userId: user.id, date, status: { in: ["PENDING", "APPROVED"] } },
    select: { id: true, status: true, createdByUserId: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (existing.createdByUserId !== user.id) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (existing.status !== "PENDING") return NextResponse.json({ error: "NOT_CANCELABLE" }, { status: 409 });

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: existing.id }, data: { status: "CANCELED" } });
    await tx.leaveRequest.updateMany({
      where: { storeId: user.storeId, linkedToId: existing.id, status: "PENDING", createdByUserId: user.id },
      data: { status: "CANCELED" },
    });
  });

  return NextResponse.json({ ok: true });
}
