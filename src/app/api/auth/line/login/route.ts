import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

let cachedEnv: Record<string, string> | null = null;
let cachedEnvKeys: string[] | null = null;

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
  cachedEnvKeys = Object.keys(merged);
  return cachedEnv;
}

export async function GET() {
  const env = loadEnvFromFiles();
  const channelId = env["LINE_CHANNEL_ID"] ?? readProcessEnv("LINE_CHANNEL_ID");
  const callbackUrl = env["LINE_CALLBACK_URL"] ?? readProcessEnv("LINE_CALLBACK_URL");

  if (!channelId || !callbackUrl) {
    return NextResponse.json(
      {
        error: "LINE_CONFIG_MISSING",
        hasChannelId: !!channelId,
        hasCallbackUrl: !!callbackUrl,
        cwd: process.cwd(),
        envLocalExists: fs.existsSync(path.resolve(process.cwd(), ".env.local")),
        envExists: fs.existsSync(path.resolve(process.cwd(), ".env")),
        envKeys: cachedEnvKeys ?? [],
      },
      { status: 500 },
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");

  const cookieStore = await cookies();
  cookieStore.set("line_login_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  cookieStore.set("line_login_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: callbackUrl,
    state,
    scope: "openid profile",
    nonce,
  });

  const url = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
  return NextResponse.redirect(url);
}
