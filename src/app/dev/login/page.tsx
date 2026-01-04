"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type DevUser = {
  id: string;
  displayName: string;
  role: string;
  storeId: string;
};

type MeResponse = {
  user: { id: string; displayName: string; role: string } | null;
  pendingLineUserId?: string | null;
};

export default function DevLoginPage() {
  const devLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";
  const [users, setUsers] = useState<DevUser[]>([]);
  const [me, setMe] = useState<MeResponse["user"]>(null);
  const [pendingLineUserId, setPendingLineUserId] = useState<string | null>(null);
  const [bindBusyUserId, setBindBusyUserId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, DevUser[]>();
    for (const u of users) {
      const list = map.get(u.role) ?? [];
      list.push(u);
      map.set(u.role, list);
    }
    return Array.from(map.entries());
  }, [users]);

  useEffect(() => {
    void fetch("/api/dev/users")
      .then((r) => r.json())
      .then((data) => setUsers(data.users ?? []));
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: MeResponse) => {
        setMe(data.user);
        setPendingLineUserId(data.pendingLineUserId ?? null);
      });

    const error = new URLSearchParams(window.location.search).get("error");
    if (error === "no_bound_user") setHint("此 LINE 尚未綁定任何員工。請先用管理者登入後綁定。");
    else if (error === "line_state") setHint("LINE 登入驗證失敗（state），請重試。");
    else if (error === "line_token") setHint("LINE 登入失敗（token），請重試。");
    else if (error === "line_profile") setHint("LINE 登入失敗（profile），請重試。");
    else if (error === "line_error") setHint("LINE 登入失敗，請重試。");
  }, []);

  async function loginAs(userId: string) {
    setBusyUserId(userId);
    try {
      const res = await fetch("/api/auth/mock-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) return;
      window.location.href = "/leave";
    } finally {
      setBusyUserId(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  async function bindLineToUser(userId: string) {
    if (!pendingLineUserId) return;
    if (!me || me.role !== "MANAGER") {
      setHint("請先用管理者登入後再綁定。");
      return;
    }

    setBindBusyUserId(userId);
    setHint(null);
    try {
      const res = await fetch("/api/admin/line/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, lineUserId: pendingLineUserId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setHint(text || "綁定失敗");
        return;
      }
      window.location.href = "/api/auth/line/login";
    } finally {
      setBindBusyUserId(null);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      {!devLoginEnabled ? (
        <>
          <h1 style={{ margin: 0 }}>此頁目前未開放</h1>
          <p style={{ marginTop: 8, color: "#555" }}>請改用 LINE 登入或回到首頁。</p>
          <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
            <a href="/api/auth/line/login">使用 LINE 登入</a>
            <Link href="/">回到首頁</Link>
          </div>
        </>
      ) : (
        <>
          <h1 style={{ margin: 0 }}>模擬登入（測試用）</h1>
          <p style={{ marginTop: 8, color: "#555" }}>
            這個頁面用來在沒有多個 LINE 帳號時切換不同角色測試。
          </p>

          {hint ? (
            <div style={{ marginTop: 10, padding: 10, border: "1px solid #f0c", borderRadius: 8, color: "#a00" }}>
              {hint}
            </div>
          ) : null}

          {pendingLineUserId ? (
            <div style={{ marginTop: 10, padding: 10, border: "1px solid #ddd", borderRadius: 8, color: "#333" }}>
              偵測到待綁定的 LINE userId（已暫存）。請用管理者登入後，對應員工按「綁定 LINE」。
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div>
                目前登入：{me ? `${me.displayName} (${me.role})` : "未登入"}
              </div>
              <a href="/api/auth/line/login">使用 LINE 登入</a>
              <Link href="/leave">前往員工端</Link>
              <Link href="/admin">前往後台</Link>
              <button onClick={logout} style={{ padding: "6px 10px" }}>
                登出
              </button>
            </div>
          </div>

          <hr style={{ margin: "20px 0" }} />

          {grouped.map(([role, list]) => (
            <div key={role} style={{ marginBottom: 18 }}>
              <h2 style={{ margin: "0 0 8px 0" }}>{role}</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {list.map((u) => {
                  const canBind = !!pendingLineUserId && !!me && me.role === "MANAGER";
                  return (
                    <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={() => loginAs(u.id)}
                        disabled={busyUserId === u.id}
                        style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 8 }}
                      >
                        {u.displayName}
                      </button>
                      {pendingLineUserId ? (
                        <button
                          onClick={() => bindLineToUser(u.id)}
                          disabled={!canBind || bindBusyUserId === u.id}
                          style={{
                            padding: "8px 12px",
                            border: "1px solid #2563eb",
                            borderRadius: 8,
                            background: canBind ? "#eff6ff" : "#f5f5f5",
                            color: canBind ? "#1d4ed8" : "#777",
                            cursor: canBind ? "pointer" : "not-allowed",
                          }}
                        >
                          綁定 LINE
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
