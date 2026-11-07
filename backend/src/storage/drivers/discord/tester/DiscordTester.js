/**
 * DISCORD 驅動連線測試器（Bot API）
 *
 * 最小測試目標：
 * 1) bot_token 是否有效（401/403 能識別）
 * 2) bot 是否能訪問指定頻道（GET /channels/{channel_id}）
 *
 * 官方文件參考：
 * - https://discord.com/developers/docs/resources/channel#get-channel
 * - https://discord.com/developers/docs/reference#rate-limits
 */

import { ValidationError } from "../../../../http/errors.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";

function normalizeEndpointUrl(value, fallback) {
  const raw = value != null ? String(value).trim() : "";
  const base = raw ? raw.replace(/\/+$/, "") : String(fallback || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError("endpoint_url 必須以 http:// 或 https:// 開頭");
    }
  } catch {
    throw new ValidationError("endpoint_url 不是合法的 URL");
  }
  return base;
}

async function fetchJson(url, init = {}) {
  const resp = await fetch(url, init);
  const text = await resp.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { resp, json, text };
}

function parseRetryAfterMs(resp, json) {
  const retryAfterSec = typeof json?.retry_after === "number" ? json.retry_after : null;
  const retryAfterHeader = resp?.headers?.get?.("retry-after");
  const retryAfterHeaderSec = retryAfterHeader != null && retryAfterHeader !== "" ? Number(retryAfterHeader) : null;
  const retryAfter = Number.isFinite(retryAfterSec)
    ? retryAfterSec
    : Number.isFinite(retryAfterHeaderSec)
    ? retryAfterHeaderSec
    : null;
  return retryAfter != null ? Math.ceil(retryAfter * 1000) : null;
}

export async function discordTestConnection(config, encryptionSecret, _requestOrigin = null) {
  const botTokenEncrypted = config?.bot_token || config?.botToken;
  const tokenRaw = await decryptIfNeeded(botTokenEncrypted, encryptionSecret);
  const botToken = typeof tokenRaw === "string" ? tokenRaw.trim() : "";

  const channelIdRaw = config?.channel_id || config?.channelId;
  const channelId = channelIdRaw != null ? String(channelIdRaw).trim() : "";

  const apiBase = normalizeEndpointUrl(config?.endpoint_url, DISCORD_API_BASE);

  const result = {
    info: {
      endpoint_url: apiBase,
      channelId: channelId || null,
      hasBotToken: !!botToken,
    },
    getChannel: { success: false, status: null, error: null, channel: null, retryAfterMs: null },
    typing: { success: false, status: null, error: null, retryAfterMs: null, skipped: false },
  };

  const finalize = ({ success, message }) => {
    const channel = result.getChannel.channel;
    const checks = [
      {
        key: "read",
        label: "讀許可權（getChannel）",
        success: result.getChannel.success === true,
        ...(result.getChannel.error ? { error: result.getChannel.error } : {}),
        items: [
          { key: "status", label: "狀態碼", value: result.getChannel.status },
          ...(result.getChannel.retryAfterMs != null
            ? [{ key: "retryAfterMs", label: "限速等待(ms)", value: result.getChannel.retryAfterMs }]
            : []),
          ...(channel?.id ? [{ key: "channelId", label: "頻道ID", value: channel.id }] : []),
          ...(channel?.name ? [{ key: "channelName", label: "頻道名", value: channel.name }] : []),
          ...(channel?.guild_id ? [{ key: "guildId", label: "伺服器ID", value: channel.guild_id }] : []),
          ...(channel?.type != null ? [{ key: "channelType", label: "頻道型別", value: channel.type }] : []),
        ],
        ...(channel ? { details: { channel } } : {}),
      },
      {
        key: "write",
        label: "寫許可權（typing）",
        success: result.typing.success === true,
        ...(result.typing.skipped ? { skipped: true } : {}),
        ...(result.typing.error ? { error: result.typing.error } : {}),
        note: "用 typing 作為輕量寫許可權探測（不發真實訊息）",
        items: [
          { key: "status", label: "狀態碼", value: result.typing.status },
          ...(result.typing.retryAfterMs != null
            ? [{ key: "retryAfterMs", label: "限速等待(ms)", value: result.typing.retryAfterMs }]
            : []),
        ],
      },
    ];
    return { success, message, result: { info: result.info, checks } };
  };

  if (!botToken) {
    throw new ValidationError("DISCORD 配置缺少必填欄位: bot_token");
  }
  if (!channelId) {
    throw new ValidationError("DISCORD 配置缺少必填欄位: channel_id");
  }
  if (!/^\d+$/.test(channelId)) {
    throw new ValidationError("channel_id 必須是純數字字串（Snowflake）");
  }

  const url = `${apiBase}/channels/${encodeURIComponent(channelId)}`;
  const res = await fetchJson(url, {
    method: "GET",
    headers: {
      Authorization: `Bot ${botToken}`,
      "User-Agent": "CloudHarbor-DiscordTester (https://github.com/ozuijoy/cloudharbor)",
      Accept: "application/json",
    },
  });

  result.getChannel.status = res.resp.status;

  // 429：限速（本測試器不做自動重試，只把 retryAfter 提示出來）
  if (res.resp.status === 429) {
    result.getChannel.success = false;
    result.getChannel.error = "觸發 Discord 速率限制（429），請稍後再試";
    result.getChannel.retryAfterMs = parseRetryAfterMs(res.resp, res.json);
    result.typing.skipped = true;
    result.typing.success = false;
    result.typing.error = "寫入測試未執行（讀取頻道資訊已被限速）";
    return finalize({ success: false, message: result.getChannel.error });
  }

  if (!res.resp.ok) {
    const msg =
      res.json?.message ||
      res.json?.error ||
      res.text ||
      `HTTP ${res.resp.status}`;

    // 401/403：token 無效或許可權不足（常見）
    if (res.resp.status === 401 || res.resp.status === 403) {
      result.getChannel.success = false;
      result.getChannel.error = msg || "bot_token 無效或許可權不足（401/403）";
      result.typing.skipped = true;
      result.typing.success = false;
      result.typing.error = "寫入測試未執行（讀取頻道資訊失敗）";
      return finalize({ success: false, message: "Discord 測試失敗：bot_token 無效或許可權不足" });
    }

    // 404：頻道不存在或 bot 看不到
    if (res.resp.status === 404) {
      result.getChannel.success = false;
      result.getChannel.error = msg || "頻道不存在或 bot 無法訪問（404）";
      result.typing.skipped = true;
      result.typing.success = false;
      result.typing.error = "寫入測試未執行（讀取頻道資訊失敗）";
      return finalize({ success: false, message: "Discord 測試失敗：頻道不存在或 bot 無權訪問" });
    }

    result.getChannel.success = false;
    result.getChannel.error = msg;
    result.typing.skipped = true;
    result.typing.success = false;
    result.typing.error = "寫入測試未執行（讀取頻道資訊失敗）";
    return finalize({ success: false, message: `Discord 測試失敗：無法讀取頻道資訊（HTTP ${res.resp.status}）` });
  }

  result.getChannel.success = true;
  result.getChannel.channel = {
    id: res.json?.id || null,
    name: res.json?.name || null,
    type: res.json?.type ?? null,
    guild_id: res.json?.guild_id || null,
  };

  // 讀許可權：只要能 getChannel，就說明 bot 至少“看得見”這個頻道
  // 已由 getChannel.success 表示

  // 寫許可權：用 typing 作為“能不能發訊息”的輕量測試（不發真實訊息，避免汙染頻道）
  const typingUrl = `${apiBase}/channels/${encodeURIComponent(channelId)}/typing`;
  const typingRes = await fetchJson(typingUrl, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "User-Agent": "CloudHarbor-DiscordTester (https://github.com/ozuijoy/cloudharbor)",
      Accept: "application/json",
    },
  });

  result.typing.status = typingRes.resp.status;

  if (typingRes.resp.status === 429) {
    result.typing.success = false;
    result.typing.error = "觸發 Discord 速率限制（429），typing 測試被限速";
    result.typing.retryAfterMs = parseRetryAfterMs(typingRes.resp, typingRes.json);
    return finalize({ success: false, message: "Discord 測試部分成功（讀取正常，但寫入測試觸發限速 429）" });
  }

  if (!typingRes.resp.ok) {
    const msg =
      typingRes.json?.message ||
      typingRes.json?.error ||
      typingRes.text ||
      `HTTP ${typingRes.resp.status}`;
    result.typing.success = false;
    result.typing.error = msg || "typing 請求失敗";
    return finalize({ success: false, message: "Discord 測試部分成功（bot 可訪問頻道，但可能沒有傳送訊息許可權）" });
  }

  result.typing.success = true;
  return finalize({ success: true, message: "Discord 測試成功（bot 可訪問該頻道，並且具備傳送訊息許可權）" });
}

export default { discordTestConnection };
