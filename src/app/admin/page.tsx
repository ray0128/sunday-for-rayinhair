import Link from "next/link";
import { revalidatePath } from "next/cache";
import type { Prisma, Role } from ".prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isIsoDate } from "@/lib/date";

const CONFIG_LABELS: Record<
  string,
  {
    label: string;
    note?: string;
  }
> = {
  assistant_block_if_master_working: {
    label: "老師上班時鎖定助理排假",
    note: "true：老師當日上班，綁定助理不可自己請假",
  },
  assistant_block_saturday: {
    label: "助理週六是否禁休",
    note: "true：所有助理週六不能排假",
  },
  assistant_supply: {
    label: "單一助理戰力需求",
    note: "通常設為 1，代表 1 位助理的完整戰力",
  },
  binding_mirror_leave: {
    label: "師徒一起休假模式",
    note: "auto_create：老師請假時，自動幫綁定助理送出假單",
  },
  designer_default_demand: {
    label: "單一設計師人力需求",
    note: "作為全域預設；若未為個別設計師填入需求值，則使用此值",
  },
  phase1_start_day: {
    label: "設計師排假起始日",
    note: "每月第幾天開始只開放設計師排假，例如 1",
  },
  phase1_end_day: {
    label: "設計師排假結束日",
    note: "每月第幾天結束設計師優先排假，例如 5",
  },
  phase2_start_day: {
    label: "助理 / 新秀排假起始日",
    note: "每月第幾天開始開放助理與新秀排假，例如 6",
  },
  phase2_end_day: {
    label: "助理 / 新秀排假結束日",
    note: "每月第幾天後就不再開放排假，例如 10；留空代表當月底",
  },
  safety_factor: {
    label: "安全係數",
    note: ">1 代表略為放大設計師需求，留安全餘裕",
  },
  rookie_support_supply: {
    label: "新秀支援戰力",
    note: "新秀幫忙現場時的支援量，例如 0.7",
  },
  rookie_guest_supply: {
    label: "新秀做客戰力",
    note: "新秀有自己客人時的可支援量，通常為 0",
  },
  rookie_any_booking_supply_zero: {
    label: "新秀有客是否不提供支援",
    note: "true：當日只要有預約客，就視為戰力為 0",
  },
  closed_dates: {
    label: "公休日（店休）",
    note: "以逗號分隔的日期清單，例如 2026-01-01,2026-01-15",
  },
  closed_weekdays: {
    label: "公休日（固定星期）",
    note: "以逗號分隔，例如 SUN,MON 表示每週日、週一公休（SUN,MON,TUE,WED,THU,FRI,SAT）",
  },
};

const CONFIG_GROUPS: { id: string; title: string; description?: string; keys: string[] }[] = [
  {
    id: "phase",
    title: "排假階段設定",
    description: "設定每月幾號到幾號可以排假，以及各職位開放順序",
    keys: ["phase1_start_day", "phase1_end_day", "phase2_start_day", "phase2_end_day"],
  },
  {
    id: "capacity",
    title: "人力與戰力設定",
    description: "決定一位設計師 / 助理 / 新秀在系統中的需求與支援量",
    keys: ["designer_default_demand", "assistant_supply", "rookie_support_supply", "rookie_guest_supply", "safety_factor"],
  },
  {
    id: "rules",
    title: "排假規則",
    description: "控制哪些情況下禁止請假，例如老師上班或週六助理禁休",
    keys: ["assistant_block_if_master_working", "assistant_block_saturday", "rookie_any_booking_supply_zero", "binding_mirror_leave"],
  },
  {
    id: "closed",
    title: "店休日設定",
    description: "設定店休日（整天不營業），系統會自動鎖住員工排假",
    keys: ["closed_dates", "closed_weekdays"],
  },
];

const CONFIG_INPUT: Record<
  string,
  | { kind: "boolean" }
  | { kind: "number"; step?: number }
  | { kind: "day" }
  | { kind: "text" }
  | { kind: "select"; options: { value: string; label: string }[] }
> = {
  designer_default_demand: { kind: "number", step: 0.1 },
  assistant_supply: { kind: "number", step: 0.1 },
  rookie_support_supply: { kind: "number", step: 0.1 },
  rookie_guest_supply: { kind: "number", step: 0.1 },
  safety_factor: { kind: "number", step: 0.05 },
  phase1_start_day: { kind: "day" },
  phase1_end_day: { kind: "day" },
  phase2_start_day: { kind: "day" },
  phase2_end_day: { kind: "day" },
  assistant_block_if_master_working: { kind: "boolean" },
  assistant_block_saturday: { kind: "boolean" },
  rookie_any_booking_supply_zero: { kind: "boolean" },
  binding_mirror_leave: {
    kind: "select",
    options: [
      { value: "auto_create", label: "老師請假時，自動幫助理排同一天" },
      { value: "off", label: "關閉師徒連動（僅老師本人請假）" },
    ],
  },
  closed_dates: { kind: "text" },
  closed_weekdays: { kind: "text" },
};

function parseValueJson(valueJson: string) {
  try {
    const obj: unknown = JSON.parse(valueJson);
    if (typeof obj === "object" && obj && "value" in obj) return (obj as { value: unknown }).value;
    return null;
  } catch {
    return null;
  }
}

function parseInputValue(raw: string) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const asNum = Number(raw);
  if (!Number.isNaN(asNum) && raw.trim() !== "") return asNum;
  return raw;
}

async function setLeaveStatus(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const user = await getCurrentUser();
  if (!user || user.role !== "MANAGER") return;
  if (!id) return;

  const lr = await prisma.leaveRequest.findFirst({ where: { id, storeId: user.storeId }, select: { id: true, status: true } });
  if (!lr || lr.status !== "PENDING") return;
  const action = String(formData.get("action") ?? "");
  if (action !== "APPROVE" && action !== "REJECT" && action !== "FORCE_APPROVE") return;
  const nextStatus = action === "REJECT" ? "REJECTED" : "APPROVED";

  await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({
      where: { id },
      data: { status: nextStatus },
      select: { id: true, linkedFrom: { select: { id: true } } },
    });
    await tx.approval.create({
      data: { storeId: user.storeId, leaveRequestId: id, managerId: user.id, action: action as "APPROVE" | "REJECT" | "FORCE_APPROVE" },
    });
    if (updated.linkedFrom.length > 0) {
      await tx.leaveRequest.updateMany({
        where: { id: { in: updated.linkedFrom.map((x) => x.id) }, status: "PENDING" },
        data: { status: nextStatus },
      });
    }
  });

  revalidatePath("/admin");
}

async function approveLeave(formData: FormData) {
  "use server";
  const next = new FormData();
  next.set("id", String(formData.get("id") ?? ""));
  next.set("action", "APPROVE");
  await setLeaveStatus(next);
}

async function rejectLeave(formData: FormData) {
  "use server";
  const next = new FormData();
  next.set("id", String(formData.get("id") ?? ""));
  next.set("action", "REJECT");
  await setLeaveStatus(next);
}

async function forceApproveLeave(formData: FormData) {
  "use server";
  const next = new FormData();
  next.set("id", String(formData.get("id") ?? ""));
  next.set("action", "FORCE_APPROVE");
  await setLeaveStatus(next);
}

async function updateUserParams(formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") ?? "");
  const rawBaseDemand = String(formData.get("baseDemand") ?? "");
  const rawBaseSupply = String(formData.get("baseSupply") ?? "");

  const me = await getCurrentUser();
  if (!me || me.role !== "MANAGER") return;
  if (!userId) return;

  const target = await prisma.user.findFirst({
    where: { id: userId, storeId: me.storeId, active: true },
    select: { id: true },
  });
  if (!target) return;

  const parseNumberOrNull = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isNaN(n)) return null;
    return n;
  };

  const baseDemand = parseNumberOrNull(rawBaseDemand);
  const baseSupply = parseNumberOrNull(rawBaseSupply);

  const data = { baseDemand, baseSupply } as unknown as Prisma.UserUpdateInput;

  await prisma.user.update({
    where: { id: target.id },
    data,
  });

  revalidatePath("/admin");
}

async function sendLineTestMessage(formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") ?? "");
  const me = await getCurrentUser();
  if (!me || me.role !== "MANAGER") return;
  if (!userId) return;

  const target = await prisma.user.findFirst({
    where: { id: userId, storeId: me.storeId, active: true },
    select: { lineUserId: true, displayName: true },
  });
  if (!target || !target.lineUserId) return;

  const accessToken = process.env.LINE_MESSAGING_ACCESS_TOKEN;
  if (!accessToken) return;

  const text = `提醒：${target.displayName}，這是排假系統的測試通知。`;

  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: target.lineUserId,
      messages: [{ type: "text", text }],
    }),
  });
}

async function sendLineMonthlySummary(formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") ?? "");
  const month = String(formData.get("month") ?? "");
  const me = await getCurrentUser();
  if (!me || me.role !== "MANAGER") return;
  if (!userId || !/^\d{4}-\d{2}$/.test(month)) return;

  const accessToken = process.env.LINE_MESSAGING_ACCESS_TOKEN;
  if (!accessToken) return;

  const target = await prisma.user.findFirst({
    where: { id: userId, storeId: me.storeId, active: true },
    select: { id: true, displayName: true, lineUserId: true },
  });
  if (!target || !target.lineUserId) return;

  const requests = await prisma.leaveRequest.findMany({
    where: { storeId: me.storeId, userId: target.id, date: { startsWith: `${month}-` } },
    orderBy: { date: "asc" },
    select: { date: true, status: true, source: true },
  });

  const lines: string[] = [];
  lines.push(`${target.displayName}，這是你 ${month} 的排假結果：`);

  if (requests.length === 0) {
    lines.push("本月目前沒有任何假單紀錄。");
  } else {
    for (const r of requests) {
      const status =
        r.status === "APPROVED" ? "已核准" : r.status === "REJECTED" ? "已駁回" : r.status === "PENDING" ? "待審核" : "已取消";
      const source =
        r.source === "SELF"
          ? "自行申請"
          : r.source === "MANAGER"
          ? "經理代為排假"
          : r.source === "BINDING_MIRROR"
          ? "師徒連動"
          : "系統";
      lines.push(`${r.date}：${status}（${source}）`);
    }
  }

  const text = lines.join("\n");

  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: target.lineUserId,
      messages: [{ type: "text", text }],
    }),
  });
}

async function sendLineNoLeaveReminder(formData: FormData) {
  "use server";
  const month = String(formData.get("month") ?? "");
  const me = await getCurrentUser();
  if (!me || me.role !== "MANAGER") return;
  if (!/^\d{4}-\d{2}$/.test(month)) return;

  const accessToken = process.env.LINE_MESSAGING_ACCESS_TOKEN;
  if (!accessToken) return;

  const users = await prisma.user.findMany({
    where: { storeId: me.storeId, active: true },
    select: { id: true, displayName: true, role: true, lineUserId: true },
  });

  const leaveCounts = await prisma.leaveRequest.groupBy({
    by: ["userId"],
    where: { storeId: me.storeId, date: { startsWith: `${month}-` } },
    _count: { _all: true },
  });
  const countByUser = new Map<string, number>();
  for (const row of leaveCounts) countByUser.set(row.userId, row._count._all);

  const tasks: Promise<unknown>[] = [];
  for (const u of users) {
    if (!u.lineUserId) continue;
    if (u.role === "MANAGER") continue;
    const count = countByUser.get(u.id) ?? 0;
    if (count > 0) continue;

    const text = `${u.displayName} 您好，${month} 尚未看到您的排假紀錄，若有需要休假，請儘快登入系統排假。`;
    tasks.push(
      fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          to: u.lineUserId,
          messages: [{ type: "text", text }],
        }),
      }),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function createManagerLeave(formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") ?? "");
  const date = String(formData.get("date") ?? "");

  const me = await getCurrentUser();
  if (!me || me.role !== "MANAGER") return;
  if (!userId || !isIsoDate(date)) return;

  const target = await prisma.user.findFirst({
    where: { id: userId, storeId: me.storeId, active: true },
    select: { id: true, displayName: true, lineUserId: true },
  });
  if (!target) return;

  const accessToken = process.env.LINE_MESSAGING_ACCESS_TOKEN;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findFirst({
      where: { storeId: me.storeId, userId: target.id, date },
      select: { id: true, status: true },
    });

    let leaveId: string;

    if (existing) {
      const updated = await tx.leaveRequest.update({
        where: { id: existing.id },
        data: { status: "APPROVED", source: "MANAGER", createdByUserId: me.id },
        select: { id: true },
      });
      leaveId = updated.id;
    } else {
      const created = await tx.leaveRequest.create({
        data: {
          storeId: me.storeId,
          userId: target.id,
          date,
          status: "APPROVED",
          source: "MANAGER",
          createdByUserId: me.id,
        },
        select: { id: true },
      });
      leaveId = created.id;
    }

    await tx.approval.create({
      data: {
        storeId: me.storeId,
        leaveRequestId: leaveId,
        managerId: me.id,
        action: "FORCE_APPROVE",
        reason: null,
      },
    });
  });

  if (accessToken && target.lineUserId) {
    const text = `${target.displayName} 您好，${date} 的排假已由經理核准。`;
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: target.lineUserId,
        messages: [{ type: "text", text }],
      }),
    });
  }

  revalidatePath("/admin");
}

async function updateConfig(formData: FormData) {
  "use server";
  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("value") ?? "");
  const user = await getCurrentUser();
  if (!user || user.role !== "MANAGER") return;
  if (!key) return;

  const valueJson = JSON.stringify({ value: parseInputValue(raw) });
  const existing = await prisma.config.findFirst({ where: { storeId: user.storeId, key, effectiveFrom: null }, select: { id: true } });

  if (existing) {
    await prisma.config.update({ where: { id: existing.id }, data: { valueJson } });
  } else {
    await prisma.config.create({ data: { storeId: user.storeId, key, valueJson, effectiveFrom: null, effectiveTo: null } });
  }

  revalidatePath("/admin");
}

async function clearAllLeaves() {
  "use server";
  const me = await getCurrentUser();
  if (!me || me.role !== "MANAGER") return;

  await prisma.$transaction(async (tx) => {
    await tx.approval.deleteMany({ where: { storeId: me.storeId } });
    await tx.leaveRequest.updateMany({ where: { storeId: me.storeId }, data: { linkedToId: null } });
    await tx.leaveRequest.deleteMany({ where: { storeId: me.storeId } });
  });

  revalidatePath("/admin");
}

async function deleteBinding(formData: FormData) {
  "use server";
  const id = String(formData.get("bindingId") ?? "");
  const user = await getCurrentUser();
  if (!user || user.role !== "MANAGER") return;
  if (!id) return;

  await prisma.binding.updateMany({
    where: { id, storeId: user.storeId, active: true },
    data: { active: false },
  });

  revalidatePath("/admin");
}

async function createBinding(formData: FormData) {
  "use server";
  const assistantId = String(formData.get("assistantId") ?? "");
  const designerId = String(formData.get("designerId") ?? "");
  const user = await getCurrentUser();
  if (!user || user.role !== "MANAGER") return;
  if (!assistantId || !designerId) return;

  const [assistant, designer] = await Promise.all([
    prisma.user.findFirst({ where: { id: assistantId, storeId: user.storeId, active: true }, select: { id: true, role: true } }),
    prisma.user.findFirst({ where: { id: designerId, storeId: user.storeId, active: true }, select: { id: true, role: true } }),
  ]);
  if (!assistant || (assistant.role !== "ASSISTANT" && assistant.role !== "ROOKIE")) return;
  if (!designer || designer.role !== "DESIGNER") return;

  await prisma.binding.create({ data: { storeId: user.storeId, assistantId: assistant.id, designerId: designer.id, active: true } });
  revalidatePath("/admin");
}

export default async function AdminPage() {
  const me = await getCurrentUser();

  const devLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";

  if (!me) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ margin: 0 }}>管理後台</h1>
        <p style={{ marginTop: 8 }}>尚未登入。</p>
        <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
          <Link
            href="/"
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #555",
              textDecoration: "none",
            }}
          >
            回到首頁
          </Link>
          {devLoginEnabled ? (
            <Link
              href="/dev/login"
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #fff",
                background: "#fff",
                color: "#000",
                textDecoration: "none",
              }}
            >
              前往模擬登入
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  if (me.role !== "MANAGER") {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ margin: 0 }}>管理後台</h1>
        <p style={{ marginTop: 8 }}>此頁僅限店經理。</p>
        <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
          <Link
            href="/"
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #555",
              textDecoration: "none",
            }}
          >
            回到首頁
          </Link>
          {devLoginEnabled ? (
            <Link
              href="/dev/login"
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #fff",
                background: "#fff",
                color: "#000",
                textDecoration: "none",
              }}
            >
              前往模擬登入
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  type UserParamsRow = {
    id: string;
    displayName: string;
    role: Role;
    baseDemand: number | null;
    baseSupply: number | null;
    lineUserId: string | null;
  };
  const userSelect = {
    id: true,
    displayName: true,
    role: true,
    baseDemand: true,
    baseSupply: true,
    lineUserId: true,
  } as unknown as Prisma.UserSelect;

  const [requests, configs, bindings, users] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { storeId: me.storeId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, date: true, source: true, user: { select: { displayName: true, role: true } } },
    }),
    prisma.config.findMany({
      where: { storeId: me.storeId, effectiveFrom: null },
      select: { id: true, key: true, valueJson: true },
      orderBy: { key: "asc" },
    }),
    prisma.binding.findMany({
      where: { storeId: me.storeId, active: true },
      select: {
        id: true,
        createdAt: true,
        assistant: { select: { displayName: true } },
        designer: { select: { displayName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { storeId: me.storeId, active: true },
      select: userSelect,
      orderBy: [{ role: "asc" }, { displayName: "asc" }],
    }),
  ]);

  const typedUsers = users as unknown as UserParamsRow[];
  const assistants = typedUsers.filter((u) => u.role === "ASSISTANT" || u.role === "ROOKIE");
  const designers = typedUsers.filter((u) => u.role === "DESIGNER");

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>管理後台</h1>
        <div style={{ color: "#555" }}>
          {me.displayName} ({me.role})
        </div>
        <Link href="/dev/login">切換角色</Link>
        <Link href="/leave">員工端</Link>
      </div>

      <form action={clearAllLeaves} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="submit"
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #b00",
            background: "#fdd",
            color: "#b00",
          }}
        >
          清除本店所有排假（測試用）
        </button>
        <span style={{ fontSize: 12, color: "#777" }}>僅刪除假單，不會刪除員工或綁定</span>
      </form>

      <h2 style={{ marginTop: 18 }}>待審核</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr>
              {["日期", "員工", "職位", "來源", "動作"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.date}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.user.displayName}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.user.role}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{r.source}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                  <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <button formAction={approveLeave} style={{ padding: "6px 10px" }}>
                      核准
                    </button>
                    <button formAction={rejectLeave} style={{ padding: "6px 10px" }}>
                      拒絕
                    </button>
                    <button formAction={forceApproveLeave} style={{ padding: "6px 10px" }}>
                      強制准假
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {requests.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 8, color: "#777" }}>
                  目前沒有待審核項目
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 22 }}>排假與人力設定</h2>
      <div style={{ marginTop: 4, marginBottom: 8, fontSize: 13, color: "#777" }}>
        依照門市實際狀況，調整排假階段、人力需求、店休日與相關規則。大多數欄位可透過選項或數字直接調整。
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr>
              {["設定項目", "目前數值", "修改"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const byKey = new Map(configs.map((c) => [c.key, c]));
              const allKeys = new Set<string>([...Object.keys(CONFIG_LABELS), ...configs.map((c) => c.key)]);
              const usedKeys = new Set<string>();

              const renderRow = (key: string) => {
                usedKeys.add(key);
                const c = byKey.get(key);
                const valueJson = c?.valueJson ?? JSON.stringify({ value: null });
                const currentValue = parseValueJson(valueJson);
                const meta = CONFIG_INPUT[key];

                let control: JSX.Element;
                if (meta && meta.kind === "boolean") {
                  const boolValue = currentValue === true;
                  control = (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="radio" name="value" value="true" defaultChecked={boolValue} />
                        <span>是</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="radio" name="value" value="false" defaultChecked={!boolValue} />
                        <span>否</span>
                      </label>
                    </div>
                  );
                } else if (meta && meta.kind === "number") {
                  control = (
                    <input
                      name="value"
                      type="number"
                      step={meta.step ?? 0.1}
                      defaultValue={currentValue === null || currentValue === undefined ? "" : String(currentValue)}
                      style={{ padding: "6px 8px", width: 140 }}
                    />
                  );
                } else if (meta && meta.kind === "day") {
                  control = (
                    <input
                      name="value"
                      type="number"
                      min={1}
                      max={31}
                      defaultValue={currentValue === null || currentValue === undefined ? "" : String(currentValue)}
                      style={{ padding: "6px 8px", width: 120 }}
                    />
                  );
                } else if (meta && meta.kind === "select") {
                  const current = typeof currentValue === "string" ? currentValue : "";
                  control = (
                    <select name="value" defaultValue={current} style={{ padding: "6px 8px", maxWidth: 260 }}>
                      {meta.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  );
                } else {
                  control = (
                    <input
                      name="value"
                      defaultValue={currentValue === null || currentValue === undefined ? "" : String(currentValue)}
                      style={{ padding: "6px 8px", width: 220 }}
                    />
                  );
                }

                return (
                  <tr key={c?.id ?? key}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      <div>{CONFIG_LABELS[key]?.label ?? key}</div>
                      {CONFIG_LABELS[key]?.note ? (
                        <div style={{ marginTop: 4, fontSize: 12, color: "#777" }}>{CONFIG_LABELS[key]?.note}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      <code>{JSON.stringify(currentValue)}</code>
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      <form action={updateConfig} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="hidden" name="key" value={key} />
                        {control}
                        <button style={{ padding: "6px 10px" }}>更新</button>
                      </form>
                    </td>
                  </tr>
                );
              };

              const rows: JSX.Element[] = [];

              for (const group of CONFIG_GROUPS) {
                const groupKeys = group.keys.filter((k) => allKeys.has(k));
                if (groupKeys.length === 0) continue;
                rows.push(
                  <tr key={`group-${group.id}`}>
                    <td
                      colSpan={3}
                      style={{
                        padding: 8,
                        background: "#111827",
                        color: "#e5e7eb",
                        borderTop: "1px solid #1f2937",
                        borderBottom: "1px solid #1f2937",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{group.title}</div>
                      {group.description ? (
                        <div style={{ marginTop: 2, fontSize: 12, color: "#9ca3af" }}>{group.description}</div>
                      ) : null}
                    </td>
                  </tr>,
                );
                for (const key of groupKeys) {
                  rows.push(renderRow(key));
                }
              }

              const remainingKeys = Array.from(allKeys).filter((k) => !usedKeys.has(k));
              if (remainingKeys.length > 0) {
                rows.push(
                  <tr key="group-others">
                    <td
                      colSpan={3}
                      style={{
                        padding: 8,
                        background: "#111827",
                        color: "#e5e7eb",
                        borderTop: "1px solid #1f2937",
                        borderBottom: "1px solid #1f2937",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>其他進階設定</div>
                      <div style={{ marginTop: 2, fontSize: 12, color: "#9ca3af" }}>一般情況不需調整，僅供進階調校使用。</div>
                    </td>
                  </tr>,
                );
                for (const key of remainingKeys.sort()) {
                  rows.push(renderRow(key));
                }
              }

              return rows;
            })()}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 22 }}>員工人力設定</h2>
      <div style={{ marginBottom: 4, fontSize: 13, color: "#777" }}>
        需求值：1 代表一位設計師一整天標準人力，0.5 代表半天。支援值：1 代表可完全支援一位設計師，0.5 代表支援量約半天。
        若填入個別數字則以個別為準；留空則使用上方預設值。
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr>
              {["姓名", "職位", "需求值（設計師）", "支援值（助理 / 新秀）", "修改", "LINE 測試訊息"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {typedUsers.map((u) => (
              <tr key={u.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{u.displayName}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{u.role}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                  {typeof u.baseDemand === "number" ? (
                    <code>{u.baseDemand}</code>
                  ) : (
                    <span style={{ color: "#777" }}>預設</span>
                  )}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                  {typeof u.baseSupply === "number" ? (
                    <code>{u.baseSupply}</code>
                  ) : (
                    <span style={{ color: "#777" }}>預設</span>
                  )}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                  <form action={updateUserParams} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input type="hidden" name="userId" value={u.id} />
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>需求</span>
                      <input
                        name="baseDemand"
                        defaultValue={typeof u.baseDemand === "number" ? String(u.baseDemand) : ""}
                        style={{ padding: "4px 6px", width: 80 }}
                      />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>支援</span>
                      <input
                        name="baseSupply"
                        defaultValue={typeof u.baseSupply === "number" ? String(u.baseSupply) : ""}
                        style={{ padding: "4px 6px", width: 80 }}
                      />
                    </label>
                    <button style={{ padding: "6px 10px" }}>儲存</button>
                  </form>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                  <form action={sendLineTestMessage}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button
                      type="submit"
                      disabled={!u.lineUserId}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #2563eb",
                        background: u.lineUserId ? "#eff6ff" : "#f5f5f5",
                        color: u.lineUserId ? "#1d4ed8" : "#777",
                        cursor: u.lineUserId ? "pointer" : "not-allowed",
                      }}
                    >
                      發測試訊息
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 22 }}>LINE 通知工具</h2>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
        <form
          action={sendLineMonthlySummary}
          style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span>員工</span>
            <select name="userId" style={{ padding: "6px 8px" }}>
              {typedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.role})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span>月份</span>
            <input
              name="month"
              type="month"
              style={{ padding: "6px 8px", width: 150 }}
            />
          </label>
          <button style={{ padding: "6px 10px" }}>發送單人月總結</button>
        </form>
        <form
          action={sendLineNoLeaveReminder}
          style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span>月份</span>
            <input
              name="month"
              type="month"
              style={{ padding: "6px 8px", width: 150 }}
            />
          </label>
          <button style={{ padding: "6px 10px" }}>提醒尚未排假員工</button>
        </form>
      </div>

      <h2 style={{ marginTop: 22 }}>經理代為排假</h2>
      <form
        action={createManagerLeave}
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span>員工</span>
          <select name="userId" style={{ padding: "6px 8px" }}>
            {typedUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.role})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span>日期</span>
          <input
            name="date"
            type="date"
            style={{ padding: "6px 8px", width: 170 }}
          />
        </label>
        <button style={{ padding: "6px 10px" }}>強制核准該日排假</button>
      </form>

      <h2 style={{ marginTop: 22 }}>師徒綁定</h2>
      <form action={createBinding} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          助理：
          <select name="assistantId" style={{ marginLeft: 8, padding: "6px 8px" }}>
            {assistants.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          設計師：
          <select name="designerId" style={{ marginLeft: 8, padding: "6px 8px" }}>
            {designers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </label>
        <button style={{ padding: "6px 10px" }}>新增綁定</button>
      </form>

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr>
              {["助理 / 新秀", "設計師", "建立時間", "操作"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{b.assistant.displayName}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{b.designer.displayName}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{new Date(b.createdAt).toLocaleString()}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                  <form action={deleteBinding}>
                    <input type="hidden" name="bindingId" value={b.id} />
                    <button
                      style={{
                        padding: "4px 10px",
                        borderRadius: 4,
                        border: "1px solid #b00",
                        background: "#fdd",
                        color: "#b00",
                      }}
                    >
                      刪除
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {bindings.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 8, color: "#777" }}>
                  尚未建立綁定
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
