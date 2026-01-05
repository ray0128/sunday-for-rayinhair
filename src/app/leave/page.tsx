"use client";

import { useEffect, useMemo, useState } from "react";

type AuthUser = { id: string; displayName: string; role: string } | null;
type MeResponse = { user: AuthUser };

type AvailabilityDay = {
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
  offUsers: { userId: string; displayName: string; role: string; status: "PENDING" | "APPROVED" }[];
};

type AvailabilityResponse = {
  month: string;
  days: AvailabilityDay[];
};

type RookieBooking = { id: string; date: string; startMin: number; endMin: number };

async function safeReadJson(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function reasonToLabel(reason: string) {
  if (reason === "PHASE_LOCK") return "目前尚未開放此職位排假（不在可排假日期區間）";
  if (reason === "QUOTA_FULL") return "當日名額已滿";
  if (reason === "SATURDAY_BLOCK") return "週六助理禁休";
  if (reason === "MASTER_WORKING_BLOCK") return "老師當日上班，助理不可休";
  if (reason === "STORE_CLOSED") return "公休日（本日不營業）";
  return reason;
}

function reasonsToText(reasons: string[]) {
  if (reasons.length === 0) return "";
  return reasons.map((r) => reasonToLabel(r)).join(" / ");
}

function leaveStatusToText(status: AvailabilityDay["myLeaveStatus"]) {
  if (status === "PENDING") return "待審核";
  if (status === "APPROVED") return "已核准";
  return "";
}

function roleToShort(role: string) {
  if (role === "DESIGNER") return "設";
  if (role === "ASSISTANT") return "助";
  if (role === "ROOKIE") return "新";
  if (role === "MANAGER") return "管";
  return role;
}

function currentMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthDaysGrid(days: AvailabilityDay[]) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days[0]?.date;
  if (!first) return { weeks: [] as (AvailabilityDay | null)[][] };
  const [y, m] = first.split("-").map((v) => Number(v));
  const firstDate = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  const startDow = firstDate.getUTCDay();

  const list: (AvailabilityDay | null)[] = [];
  for (let i = 0; i < startDow; i += 1) list.push(null);
  for (const d of days) list.push(byDate.get(d.date) ?? null);

  const weeks: (AvailabilityDay | null)[][] = [];
  for (let i = 0; i < list.length; i += 7) weeks.push(list.slice(i, i + 7));
  return { weeks };
}

export default function LeavePage() {
  const [me, setMe] = useState<AuthUser>(null);
  const [month, setMonth] = useState(currentMonth());
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [rookieBookings, setRookieBookings] = useState<RookieBooking[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [detailDay, setDetailDay] = useState<AvailabilityDay | null>(null);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      const res = await fetch("/api/auth/me").catch(() => null);
      if (!res) {
        if (!canceled) setMessage("讀取登入狀態失敗（網路錯誤）");
        return;
      }
      const data = (await safeReadJson(res)) as MeResponse | null;
      if (!res.ok || !data) {
        if (!canceled) setMessage("讀取登入狀態失敗（伺服器錯誤）");
        return;
      }
      if (!canceled) setMe(data.user);
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    let canceled = false;
    void (async () => {
      const res = await fetch(`/api/calendar/availability?month=${encodeURIComponent(month)}`).catch(() => null);
      if (!res) {
        if (!canceled) setMessage("讀取日曆失敗（網路錯誤）");
        return;
      }
      const data = (await safeReadJson(res)) as AvailabilityResponse | null;
      if (!res.ok || !data) {
        if (!canceled) setMessage("讀取日曆失敗（伺服器錯誤）");
        return;
      }
      if (!canceled) setAvailability(data);
    })();
    return () => {
      canceled = true;
    };
  }, [me, month]);

  useEffect(() => {
    if (!me) return;
    if (me.role !== "ROOKIE") return;
    let canceled = false;
    void (async () => {
      const res = await fetch(`/api/rookie/bookings?month=${encodeURIComponent(month)}`).catch(() => null);
      if (!res) return;
      const data = (await safeReadJson(res)) as { bookings?: RookieBooking[] } | null;
      if (!res.ok || !data) return;
      if (!canceled) setRookieBookings(data.bookings ?? []);
    })();
    return () => {
      canceled = true;
    };
  }, [me, month]);

  const grid = useMemo(() => monthDaysGrid(availability?.days ?? []), [availability]);
  const bookingsByDate = useMemo(() => {
    const map = new Map<string, RookieBooking[]>();
    for (const b of rookieBookings) {
      const list = map.get(b.date) ?? [];
      list.push(b);
      map.set(b.date, list);
    }
    return map;
  }, [rookieBookings]);
  const todayIso = new Date().toISOString().slice(0, 10);

  async function requestLeave(date: string) {
    setBusyDate(date);
    setMessage(null);
    try {
      const res = await fetch("/api/leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const data = await safeReadJson(res);
      const obj = asRecord(data);
      if (!res.ok) {
        const rawReasonsUnknown = obj?.reasons;
        const rawReasons: string[] = Array.isArray(rawReasonsUnknown)
          ? rawReasonsUnknown.filter((x): x is string => typeof x === "string")
          : [];
        const text = reasonsToText(rawReasons);
        if (text) {
          setMessage(text);
        } else {
          setMessage("目前無法排這一天");
        }
        return;
      }
      setMessage(`已送出：${date}（待審核）`);
      setAvailability((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: prev.days.map((d) =>
            d.date === date ? { ...d, myLeaveStatus: "PENDING", myLeaveCancelable: true } : d,
          ),
        };
      });
      setDetailDay((prev) =>
        prev && prev.date === date ? { ...prev, myLeaveStatus: "PENDING", myLeaveCancelable: true } : prev,
      );
      const updatedRes = await fetch(`/api/calendar/availability?month=${encodeURIComponent(month)}`).catch(() => null);
      if (!updatedRes) return;
      const updated = (await safeReadJson(updatedRes)) as AvailabilityResponse | null;
      if (updatedRes.ok && updated) setAvailability(updated);
    } finally {
      setBusyDate(null);
    }
  }

  async function clearLeave(date: string) {
    setBusyDate(date);
    setMessage(null);
    try {
      const res = await fetch("/api/leave", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        setMessage("目前無法清除這一天");
        return;
      }
      setMessage(`已清除：${date}`);
      setAvailability((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: prev.days.map((d) =>
            d.date === date ? { ...d, myLeaveStatus: null, myLeaveCancelable: false } : d,
          ),
        };
      });
      setDetailDay((prev) =>
        prev && prev.date === date ? { ...prev, myLeaveStatus: null, myLeaveCancelable: false } : prev,
      );
      const updatedRes = await fetch(`/api/calendar/availability?month=${encodeURIComponent(month)}`).catch(() => null);
      if (!updatedRes) return;
      const updated = (await safeReadJson(updatedRes)) as AvailabilityResponse | null;
      if (updatedRes.ok && updated) setAvailability(updated);
    } finally {
      setBusyDate(null);
    }
  }

  async function addFullDayBooking(date: string) {
    if (bookingBusy) return;
    setMessage(null);
    setBookingBusy(true);
    try {
      const res = await fetch("/api/rookie/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, startMin: 0, endMin: 1440 }),
      });
      const data = await safeReadJson(res);
      const obj = asRecord(data);
      if (!res.ok) {
        const err = typeof obj?.error === "string" ? obj.error : null;
        setMessage(err ?? "ERROR");
        return;
      }
      const updatedBookingsRes = await fetch(`/api/rookie/bookings?month=${encodeURIComponent(month)}`).catch(() => null);
      if (updatedBookingsRes) {
        const updatedBookings = (await safeReadJson(updatedBookingsRes)) as { bookings?: RookieBooking[] } | null;
        if (updatedBookingsRes.ok && updatedBookings) setRookieBookings(updatedBookings.bookings ?? []);
      }
      const updatedRes = await fetch(`/api/calendar/availability?month=${encodeURIComponent(month)}`).catch(() => null);
      if (updatedRes) {
        const updated = (await safeReadJson(updatedRes)) as AvailabilityResponse | null;
        if (updatedRes.ok && updated) setAvailability(updated);
      }
    } catch {
      setMessage("網路錯誤，請稍後再試");
    } finally {
      setBookingBusy(false);
    }
  }

  async function removeBooking(id: string) {
    await fetch(`/api/rookie/bookings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const updatedBookingsRes = await fetch(`/api/rookie/bookings?month=${encodeURIComponent(month)}`).catch(() => null);
    if (updatedBookingsRes) {
      const updatedBookings = (await safeReadJson(updatedBookingsRes)) as { bookings?: RookieBooking[] } | null;
      if (updatedBookingsRes.ok && updatedBookings) setRookieBookings(updatedBookings.bookings ?? []);
    }
    const updatedRes = await fetch(`/api/calendar/availability?month=${encodeURIComponent(month)}`).catch(() => null);
    if (updatedRes) {
      const updated = (await safeReadJson(updatedRes)) as AvailabilityResponse | null;
      if (updatedRes.ok && updated) setAvailability(updated);
    }
  }

  if (!me) {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 16,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>員工端（日曆）</h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "#9ca3af", maxWidth: 320 }}>
          尚未登入。請先透過 LINE 或模擬登入進入系統。
        </p>
        <a
          href="/dev/login"
          style={{
            marginTop: 16,
            padding: "10px 16px",
            borderRadius: 999,
            border: "1px solid #2563eb",
            background: "#1d4ed8",
            color: "#fff",
            fontSize: 14,
          }}
        >
          前往登入
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>員工排假日曆</h1>
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            {me.displayName}（{me.role}）
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
          <a href="/admin" style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #4b5563" }}>
            管理後台
          </a>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <span>月份</span>
          <input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            type="month"
            style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #d1d5db" }}
          />
        </label>
        <span style={{ color: "#9ca3af", fontSize: 12 }}>選擇月份後，下方日曆會同步更新</span>
      </div>

      {message ? (
        <div
          style={{
            marginTop: 12,
            padding: "8px 10px",
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {message}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 16,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          overflowX: "hidden",
          overflowY: "hidden",
          background: "#ffffff",
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <thead>
            <tr>
              {["日", "一", "二", "三", "四", "五", "六"].map((x) => {
                const isWeekend = x === "日" || x === "六";
                return (
                  <th
                    key={x}
                    style={{
                      textAlign: "center",
                      padding: 8,
                      borderBottom: "1px solid #e5e7eb",
                      fontSize: 12,
                      fontWeight: 500,
                      color: isWeekend ? "#dc2626" : "#4b5563",
                      background: "#f9fafb",
                    }}
                  >
                    {x}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.weeks.map((w, idx) => (
              <tr key={idx}>
                {w.map((d, j) => {
                  if (!d)
                    return (
                    <td
                      key={j}
                      style={{ padding: 6, borderBottom: "1px solid #e5e7eb", minWidth: 0, height: 72 }}
                    />
                    );
                  const dayNum = d.date.slice(-2);
                  const hasMyLeave = d.myLeaveStatus !== null;
                  const isBusy = busyDate === d.date;
                  const disabled = hasMyLeave || !d.selectable || isBusy;
                  const bg = d.selectable ? "#eaffea" : "#f4f4f4";
                  const fg = disabled ? "#777" : "#111";
                  const myBookings = bookingsByDate.get(d.date) ?? [];
                  const isToday = d.date === todayIso;
                  const isWeekendCol = j === 0 || j === 6;
                  let quotaLabel = "";
                  let quotaBg = "#e5e7eb";
                  let quotaColor = "#374151";
                  if (d.remainingQuota > 0.5) {
                    quotaLabel = "名額充足";
                    quotaBg = "#dcfce7";
                    quotaColor = "#166534";
                  } else if (d.remainingQuota >= 0) {
                    quotaLabel = "名額緊繃";
                    quotaBg = "#fef9c3";
                    quotaColor = "#854d0e";
                  } else {
                    quotaLabel = "名額不足";
                    quotaBg = "#fee2e2";
                    quotaColor = "#b91c1c";
                  }
                  return (
                    <td
                      key={j}
                      onClick={() => setDetailDay(d)}
                      style={{
                        verticalAlign: "top",
                        padding: 6,
                        borderBottom: "1px solid #e5e7eb",
                        minWidth: 0,
                        height: 72,
                        background: isToday ? "#eff6ff" : isWeekendCol ? "#f9fafb" : "#ffffff",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: 13, color: isToday ? "#2563eb" : "#111827" }}>
                          {Number(dayNum)}
                        </strong>
                        <span
                          style={{
                            fontSize: 11,
                            borderRadius: 999,
                            padding: "2px 6px",
                            background: quotaBg,
                            color: quotaColor,
                          }}
                        >
                          {quotaLabel}
                        </span>
                      </div>
                      <button
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          void requestLeave(d.date);
                        }}
                        style={{
                          marginTop: 6,
                          padding: "4px 8px",
                          border: "1px solid #ddd",
                          borderRadius: 8,
                          background: bg,
                          color: fg,
                          cursor: disabled ? "not-allowed" : "pointer",
                          fontSize: 12,
                          maxWidth: "100%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {hasMyLeave
                          ? `已排休（${leaveStatusToText(d.myLeaveStatus)}）`
                          : isBusy
                          ? "送出中..."
                          : "排休"}
                      </button>
                      {!d.selectable && d.reasons.length > 0 ? (
                        <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>{reasonsToText(d.reasons)}</div>
                      ) : null}
                      {me.role === "ROOKIE" ? (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 12, color: "#555" }}>預約客：{myBookings.length} 筆</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void addFullDayBooking(d.date);
                              }}
                              disabled={bookingBusy}
                              style={{
                                padding: "6px 8px",
                                border: "1px solid #ddd",
                                borderRadius: 8,
                                cursor: bookingBusy ? "not-allowed" : "pointer",
                                color: bookingBusy ? "#777" : "#111",
                                background: "#fff",
                              }}
                            >
                              新增有客
                            </button>
                            {myBookings.slice(0, 2).map((b) => (
                              <button
                                key={b.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeBooking(b.id);
                                }}
                                style={{ padding: "6px 8px", border: "1px solid #ddd", borderRadius: 8 }}
                              >
                                刪除 {b.startMin}-{b.endMin}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detailDay ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setDetailDay(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 360,
              background: "#ffffff",
              borderRadius: 16,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {detailDay.date}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
              名額狀態：
              {detailDay.remainingQuota > 0.5
                ? "名額充足"
                : detailDay.remainingQuota >= 0
                ? "名額緊繃"
                : "名額不足"}
            </div>
            <div style={{ marginTop: 12, fontSize: 13 }}>
              我的排假：
            {detailDay.myLeaveStatus
              ? `已排休（${leaveStatusToText(detailDay.myLeaveStatus)}）`
              : "尚未排假"}
            </div>
            {detailDay.myLeaveCancelable && (
              <button
                disabled={busyDate === detailDay.date}
                onClick={() => void clearLeave(detailDay.date)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #b91c1c",
                  background: "#fef2f2",
                  color: "#b91c1c",
                  fontSize: 13,
                  cursor: busyDate === detailDay.date ? "not-allowed" : "pointer",
                }}
              >
                清除這一天的排假
              </button>
            )}
            {detailDay.offUsers.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>這一天休假的人</div>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {detailDay.offUsers.map((u) => {
                    const pending = u.status === "PENDING";
                    const isDesigner = u.role === "DESIGNER";
                    const border = isDesigner ? "#2563eb" : "#f97316";
                    const bg = isDesigner ? "#eff6ff" : "#fff7ed";
                    const color = isDesigner ? "#1d4ed8" : "#c2410c";
                    return (
                      <div key={`${u.userId}:${u.status}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            border: `1px solid ${border}`,
                            background: bg,
                            color,
                            borderRadius: 999,
                            padding: "4px 10px",
                            fontSize: 13,
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {u.displayName}({roleToShort(u.role)})
                        </span>
                        {pending ? <span style={{ fontSize: 12, color: "#b91c1c" }}>待審核</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 16, fontSize: 13, color: "#6b7280" }}>目前沒有其他人休這一天</div>
            )}
            {!detailDay.selectable && detailDay.reasons.length > 0 ? (
              <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af" }}>
                無法排假的原因：{reasonsToText(detailDay.reasons)}
              </div>
            ) : null}
            <button
              onClick={() => setDetailDay(null)}
              style={{
                marginTop: 18,
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "#f9fafb",
                fontSize: 13,
              }}
            >
              關閉
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
