import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

let cachedEnv: Record<string, string> | null = null;

function htmlRedirect(to: string, title: string, detail?: string) {
  const safeTo = to.startsWith("/") ? to : "/";
  const html = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${safeTo}" />
    <title>${title}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 24px;">
    <h1 style="margin: 0;">${title}</h1>
    ${detail ? `<p style="margin-top: 8px; color: #444;">${detail}</p>` : ""}
    <p style="margin-top: 12px;">
      若未自動跳轉，請點 <a href="${safeTo}">這裡</a>。
    </p>
    <script>
      window.location.replace(${JSON.stringify(safeTo)});
    </script>
  </body>
</html>`;

  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function decodeEnvFile(filePath: string) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2) {
    const b0 = buf[0];
    const b1 = buf[1];
    const looksUtf16le = b0 === 0xff && b1 === 0xfe;
    const looksUtf16be = b0 === 0xfe && b1 === 0xff;
    const hasNullBytes = buf.includes(0);
    if (looksUtf16be) {
      const swapped = Buffer.alloc(Math.max(0, buf.length - 2));
      for (let i = 2; i + 1 < buf.length; i += 2) {
        swapped[i - 2] = buf[i + 1];
        swapped[i - 1] = buf[i];
      }
      return swapped.toString("utf16le").replace(/^\uFEFF/, "");
    }
    if (looksUtf16le || hasNullBytes) {
      return buf.toString("utf16le").replace(/^\uFEFF/, "");
    }
  }
  return buf.toString("utf8").replace(/^\uFEFF/, "");
}

function parseEnvFromString(text: string) {
  const out: Record<string, string> = {};
  const normalized = text.replace(/\u0000/g, "");
  for (const rawLine of normalized.split(/\r?\n|\r/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line
      .slice(0, idx)
      .replace(/^\uFEFF/, "")
      .trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readProcessEnv(key: string) {
  return process.env[key];
}

function loadEnvFromFiles() {
  if (cachedEnv) return cachedEnv;
  const merged: Record<string, string> = {};
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), ".env.local")];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    dotenv.config({ path: p, override: true });
    const parsed = parseEnvFromString(decodeEnvFile(p));
    for (const [k, v] of Object.entries(parsed)) {
      if (!k) continue;
      merged[k] = v;
      process.env[k] = v;
    }
  }
  cachedEnv = merged;
  return cachedEnv;
}

type LineTokenResponse = {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

type LineProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
};

async function exchangeCodeForToken(code: string) {
  const env = loadEnvFromFiles();
  const channelId = env["LINE_CHANNEL_ID"] ?? readProcessEnv("LINE_CHANNEL_ID");
  const channelSecret = env["LINE_CHANNEL_SECRET"] ?? readProcessEnv("LINE_CHANNEL_SECRET");
  const callbackUrl = env["LINE_CALLBACK_URL"] ?? readProcessEnv("LINE_CALLBACK_URL");

  if (!channelId || !channelSecret || !callbackUrl) {
    throw new Error("LINE_CONFIG_MISSING");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl,
    client_id: channelId,
    client_secret: channelSecret,
  });

  const res = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error("LINE_TOKEN_EXCHANGE_FAILED");
  }

  const data = (await res.json()) as LineTokenResponse;
  if (!data.access_token) {
    throw new Error("LINE_TOKEN_MISSING");
  }
  return data;
}

async function fetchLineProfile(accessToken: string) {
  const res = await fetch("https://api.line.me/v2/profile", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error("LINE_PROFILE_FAILED");
  }

  const data = (await res.json()) as LineProfile;
  if (!data.userId) {
    throw new Error("LINE_PROFILE_MISSING_USER_ID");
  }
  return data;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const storedState = cookieStore.get("line_login_state")?.value;

  cookieStore.set("line_login_state", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  cookieStore.set("line_login_nonce", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });

  if (error) {
    return htmlRedirect("/dev/login?error=line_error", "LINE 登入失敗", "LINE 回傳登入錯誤。");
  }

  if (!code || !state || !storedState || state !== storedState) {
    return htmlRedirect("/dev/login?error=line_state", "LINE 登入失敗", "state 驗證失敗，請重試。");
  }

  let token: LineTokenResponse;
  try {
    token = await exchangeCodeForToken(code);
  } catch {
    return htmlRedirect("/dev/login?error=line_token", "LINE 登入失敗", "交換 token 失敗，請重試。");
  }

  let profile: LineProfile;
  try {
    profile = await fetchLineProfile(token.access_token);
  } catch {
    return htmlRedirect("/dev/login?error=line_profile", "LINE 登入失敗", "讀取 LINE profile 失敗，請重試。");
  }

  const user = await prisma.user.findFirst({
    where: { lineUserId: profile.userId, active: true },
    select: { id: true },
  });

  if (!user) {
    cookieStore.set("pending_line_user_id", profile.userId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });
    return htmlRedirect("/dev/login?error=no_bound_user", "尚未綁定員工", "請用管理者帳號把此 LINE 綁定到員工。");
  }

  cookieStore.set("pending_line_user_id", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  cookieStore.set("mock_user_id", user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return htmlRedirect("/leave", "登入成功", "正在前往員工端。");
}
