import { prisma } from "@/lib/prisma";
import { getBooleanConfig, getNumberConfig, getStringConfig } from "@/lib/config";
import { dateFromMonthDay, daysInMonth, dayOfMonthInTimeZone, weekdayInTimeZone } from "@/lib/date";

type Role = "DESIGNER" | "ASSISTANT" | "ROOKIE" | "MANAGER";

export type AvailabilityDay = {
  date: string;
  remainingQuota: number;
  assistantSupply: number;
  rookieSupply: number;
  designerDemand: number;
  safetyFactor: number;
  selectable: boolean;
  reasons: string[];
  myLeaveStatus: "PENDING" | "APPROVED" | null;
  myLeaveCancelable: boolean;
  offUsers: { userId: string; displayName: string; role: Role; status: "PENDING" | "APPROVED" }[];
};

function isOffStatus(status: string) {
  return status === "PENDING" || status === "APPROVED";
}

export async function getMonthAvailability(params: {
  storeId: string;
  storeTimeZone: string;
  month: string;
  requester: { userId: string; role: Role };
}) {
  const { storeId, storeTimeZone, month, requester } = params;
  const safetyFactor = await getNumberConfig(storeId, "safety_factor", 1.1);
  const assistantSupply = await getNumberConfig(storeId, "assistant_supply", 1.0);
  const rookieSupportSupply = await getNumberConfig(storeId, "rookie_support_supply", 0.7);
  const rookieGuestSupply = await getNumberConfig(storeId, "rookie_guest_supply", 0);
  const designerDefaultDemand = await getNumberConfig(storeId, "designer_default_demand", 1.0);
  const closedDatesRaw = await getStringConfig(storeId, "closed_dates", "");
  const closedDates = new Set(
    closedDatesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  );
  const closedWeekdaysRaw = await getStringConfig(storeId, "closed_weekdays", "");
  const closedWeekdays = new Set(
    closedWeekdaysRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].includes(s)),
  );

  const phase1Start = await getNumberConfig(storeId, "phase1_start_day", 1);
  const phase1End = await getNumberConfig(storeId, "phase1_end_day", 5);
  const phase2Start = await getNumberConfig(storeId, "phase2_start_day", 6);
  const phase2End = await getNumberConfig(storeId, "phase2_end_day", 31);

  const assistantBlockSaturday = await getBooleanConfig(storeId, "assistant_block_saturday", true);
  const assistantBlockIfMasterWorking = await getBooleanConfig(storeId, "assistant_block_if_master_working", true);
  const rookieAnyBookingSupplyZero = await getBooleanConfig(storeId, "rookie_any_booking_supply_zero", true);

  type UserRow = { id: string; role: Role; baseDemand: number | null; baseSupply: number | null };
  const users = (await prisma.user.findMany({
    where: { storeId, active: true },
    select: { id: true, role: true, baseDemand: true, baseSupply: true },
  })) as unknown as UserRow[];

  const assistants = users.filter((u) => u.role === "ASSISTANT");
  const rookies = users.filter((u) => u.role === "ROOKIE");
  const designers = users.filter((u) => u.role === "DESIGNER");

  const leaveRequests = await prisma.leaveRequest.findMany({
    where: {
      storeId,
      date: { startsWith: `${month}-` },
      status: { in: ["PENDING", "APPROVED"] },
    },
    select: {
      userId: true,
      date: true,
      status: true,
      createdByUserId: true,
      user: { select: { displayName: true, role: true } },
    },
  });

  const offByUserDate = new Set<string>();
  for (const lr of leaveRequests) {
    if (isOffStatus(lr.status)) offByUserDate.add(`${lr.userId}:${lr.date}`);
  }

  const myLeaveByDate = new Map<string, { status: "PENDING" | "APPROVED"; cancelable: boolean }>();
  for (const lr of leaveRequests) {
    if (lr.userId !== requester.userId) continue;
    if (!isOffStatus(lr.status)) continue;
    const status = lr.status === "APPROVED" ? "APPROVED" : "PENDING";
    myLeaveByDate.set(lr.date, { status, cancelable: status === "PENDING" && lr.createdByUserId === requester.userId });
  }

  const offUsersByDate = new Map<string, AvailabilityDay["offUsers"]>();
  for (const lr of leaveRequests) {
    if (!isOffStatus(lr.status)) continue;
    const status = lr.status === "APPROVED" ? "APPROVED" : "PENDING";
    const list = offUsersByDate.get(lr.date) ?? [];
    if (!list.some((x) => x.userId === lr.userId)) {
      list.push({ userId: lr.userId, displayName: lr.user.displayName, role: lr.user.role, status });
      offUsersByDate.set(lr.date, list);
    }
  }

  const demandOverrides = await prisma.designerDemandOverride.findMany({
    where: { storeId, date: { startsWith: `${month}-` } },
    select: { designerId: true, date: true, demand: true },
  });

  const demandOverrideByDesignerDate = new Map<string, number>();
  for (const o of demandOverrides) {
    demandOverrideByDesignerDate.set(`${o.designerId}:${o.date}`, o.demand);
  }

  const rookieBookings = await prisma.rookieBooking.findMany({
    where: { storeId, date: { startsWith: `${month}-` } },
    select: { rookieId: true, date: true },
  });

  const bookingByRookieDate = new Set<string>();
  for (const b of rookieBookings) bookingByRookieDate.add(`${b.rookieId}:${b.date}`);

  const bindingsForAssistant =
    requester.role === "ASSISTANT" && assistantBlockIfMasterWorking
      ? await prisma.binding.findMany({
          where: { storeId, assistantId: requester.userId, active: true },
          select: { designerId: true },
        })
      : [];

  const todayDay = dayOfMonthInTimeZone(storeTimeZone);
  const inDesignerWindow = todayDay >= phase1Start && todayDay <= phase1End;
  const inAssistantWindow = todayDay >= phase2Start && todayDay <= phase2End;

  const days: AvailabilityDay[] = [];
  const dim = daysInMonth(month);

  for (let d = 1; d <= dim; d += 1) {
    const date = dateFromMonthDay(month, d);
    const weekdayName = weekdayInTimeZone(storeTimeZone, date);
    const weekdayCode = weekdayName.slice(0, 3).toUpperCase();
    const isStoreClosed = closedDates.has(date) || closedWeekdays.has(weekdayCode);
    const isOff = (userId: string) => offByUserDate.has(`${userId}:${date}`);

    const assistantSupplySum = assistants.reduce((acc, u) => {
      if (isOff(u.id)) return acc;
      const weight = typeof u.baseSupply === "number" ? u.baseSupply : assistantSupply;
      return acc + weight;
    }, 0);

    const rookieSupplySum = rookies.reduce((acc, u) => {
      if (isOff(u.id)) return acc;
      const hasBooking = bookingByRookieDate.has(`${u.id}:${date}`);
      const supportWeight = typeof u.baseSupply === "number" ? u.baseSupply : rookieSupportSupply;
      if (hasBooking && rookieAnyBookingSupplyZero) return acc + rookieGuestSupply;
      return acc + supportWeight;
    }, 0);

    const designerDemandSum = designers.reduce((acc, u) => {
      if (isOff(u.id)) return acc;
      const override = demandOverrideByDesignerDate.get(`${u.id}:${date}`);
      const base = typeof u.baseDemand === "number" ? u.baseDemand : designerDefaultDemand;
      return acc + (override ?? base);
    }, 0);

    const remainingQuota = assistantSupplySum + rookieSupplySum - designerDemandSum * safetyFactor;

    const reasons: string[] = [];
    let selectable = true;

    if (requester.role === "DESIGNER") {
      if (!inDesignerWindow && !inAssistantWindow) {
        selectable = false;
        reasons.push("PHASE_LOCK");
      }
    }

    if (requester.role === "ASSISTANT" || requester.role === "ROOKIE") {
      if (!inAssistantWindow) {
        selectable = false;
        reasons.push("PHASE_LOCK");
      }
    }

    if (isStoreClosed) {
      selectable = false;
      reasons.push("STORE_CLOSED");
    }

    if (remainingQuota < 0) {
      if (requester.role === "DESIGNER") {
        // 設計師仍可排休，但提示名額已滿
        reasons.push("QUOTA_FULL");
      } else {
        selectable = false;
        reasons.push("QUOTA_FULL");
      }
    }

    if (requester.role === "ASSISTANT" && assistantBlockSaturday) {
      const weekday = weekdayInTimeZone(storeTimeZone, date);
      if (weekday.toLowerCase().startsWith("sat")) {
        selectable = false;
        reasons.push("SATURDAY_BLOCK");
      }
    }

    if (requester.role === "ASSISTANT" && assistantBlockIfMasterWorking && bindingsForAssistant.length > 0) {
      const anyMasterWorking = bindingsForAssistant.some((b) => !offByUserDate.has(`${b.designerId}:${date}`));
      if (anyMasterWorking) {
        selectable = false;
        reasons.push("MASTER_WORKING_BLOCK");
      }
    }

    const mine = myLeaveByDate.get(date);
    const offUsers = offUsersByDate.get(date) ?? [];
    days.push({
      date,
      remainingQuota,
      assistantSupply: assistantSupplySum,
      rookieSupply: rookieSupplySum,
      designerDemand: designerDemandSum,
      safetyFactor,
      selectable,
      reasons,
      myLeaveStatus: mine?.status ?? null,
      myLeaveCancelable: mine?.cancelable ?? false,
      offUsers,
    });
  }

  return { month, days };
}
