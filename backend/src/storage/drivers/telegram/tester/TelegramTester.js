/**
 * TELEGRAM 驅動連線測試器（Bot API）
 *
 *   1) bot_token 是真的（getMe 成功）
 *   2) 目標 chat_id 機器人能訪問（getChat 成功）
 *
 * - 不會發訊息、不做寫入
 * - 只做“讀 API 的確認”
 */

import { decryptIfNeeded } from "../../../../utils/crypto.js";

function normalizeApiBaseUrl(url) {
  const raw = String(url || "").trim();
  const fallback = "https://api.telegram.org";
  if (!raw) return fallback;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function fetchJson(url) {
  const resp = await fetch(url, { method: "GET" });
  const text = await resp.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { resp, json, text };
}

export async function telegramTestConnection(config, encryptionSecret, _requestOrigin = null) {
  const botTokenEncrypted = config?.bot_token || config?.botToken;
  const botToken = await decryptIfNeeded(botTokenEncrypted, encryptionSecret);
  const targetChatId = config?.target_chat_id || config?.targetChatId;
  const apiBaseUrl = normalizeApiBaseUrl(config?.endpoint_url);

  const info = {
    endpoint_url: apiBaseUrl,
    targetChatId: targetChatId ? String(targetChatId) : null,
  };
  const state = {
    getMe: { success: false, status: null, error: null, bot: null },
    getChat: { success: false, status: null, error: null, chat: null, skipped: false },
  };

  if (!botToken || typeof botToken !== "string") {
    const checks = [
      { key: "connect", label: "連線（getMe）", success: false, error: "bot_token 配置缺失" },
      { key: "read", label: "讀許可權（getChat）", success: false, error: "bot_token 配置缺失" },
      { key: "write", label: "寫許可權", success: true, skipped: true, note: "TELEGRAM 測試不做真實寫入" },
    ];
    return { success: false, message: "bot_token 配置缺失", result: { info, checks } };
  }

  // 你已決定：target_chat_id 只支援純數字字串（例如 -100...）
  if (targetChatId && !/^-?\d+$/.test(String(targetChatId).trim())) {
    const checks = [
      { key: "connect", label: "連線（getMe）", success: false, error: "target_chat_id 格式不合法" },
      { key: "read", label: "讀許可權（getChat）", success: false, error: "target_chat_id 必須是純數字（例如 -100...）" },
      { key: "write", label: "寫許可權", success: true, skipped: true, note: "TELEGRAM 測試不做真實寫入" },
    ];
    return { success: false, message: "target_chat_id 必須是純數字（例如 -100...）", result: { info, checks } };
  }

  // 1) getMe：確認 token 是否有效
  const getMeUrl = `${apiBaseUrl}/bot${String(botToken).trim()}/getMe`;
  const meRes = await fetchJson(getMeUrl);
  state.getMe.status = meRes.resp.status;

  if (!meRes.resp.ok || !meRes.json?.ok) {
    state.getMe.success = false;
    state.getMe.error = meRes.json?.description || meRes.text || "getMe 請求失敗";
    const checks = [
      {
        key: "connect",
        label: "連線（getMe）",
        success: false,
        error: state.getMe.error,
        items: [{ key: "status", label: "狀態碼", value: state.getMe.status }],
      },
      { key: "read", label: "讀許可權（getChat）", success: false, error: "bot_token 無效，跳過 getChat" },
      { key: "write", label: "寫許可權", success: true, skipped: true, note: "TELEGRAM 測試不做真實寫入" },
    ];
    return { success: false, message: `Telegram 測試失敗：bot_token 無效或無法訪問（HTTP ${meRes.resp.status}）`, result: { info, checks } };
  }

  state.getMe.success = true;
  state.getMe.bot = meRes.json?.result || null;

  // 2) getChat：確認 chat_id 是否可訪問（建議必填，否則後續上傳會失敗）
  if (!targetChatId) {
    state.getChat.skipped = true;
    const checks = [
      {
        key: "connect",
        label: "連線（getMe）",
        success: true,
        items: [
          ...(state.getMe.bot && typeof state.getMe.bot === "object"
            ? [
                { key: "botId", label: "Bot ID", value: state.getMe.bot.id ?? null },
                { key: "botUsername", label: "使用者名稱", value: state.getMe.bot.username ?? null },
                { key: "botName", label: "名稱", value: state.getMe.bot.first_name ?? null },
              ]
            : []),
        ],
        ...(state.getMe.bot ? { details: { bot: state.getMe.bot } } : {}),
      },
      {
        key: "read",
        label: "讀許可權（getChat）",
        success: true,
        skipped: true,
        note: "未填寫 target_chat_id，跳過 getChat",
      },
      { key: "write", label: "寫許可權", success: true, skipped: true, note: "TELEGRAM 測試不做真實寫入" },
    ];
    return { success: true, message: "Telegram 測試成功（已確認 bot_token；未填寫 target_chat_id，跳過 getChat）", result: { info, checks } };
  }

  const getChatUrl = `${apiBaseUrl}/bot${String(botToken).trim()}/getChat?chat_id=${encodeURIComponent(String(targetChatId).trim())}`;
  const chatRes = await fetchJson(getChatUrl);
  state.getChat.status = chatRes.resp.status;

  if (!chatRes.resp.ok || !chatRes.json?.ok) {
    state.getChat.success = false;
    state.getChat.error = chatRes.json?.description || chatRes.text || "getChat 請求失敗";
    const checks = [
      {
        key: "connect",
        label: "連線（getMe）",
        success: true,
        items: [
          ...(state.getMe.bot && typeof state.getMe.bot === "object"
            ? [
                { key: "botId", label: "Bot ID", value: state.getMe.bot.id ?? null },
                { key: "botUsername", label: "使用者名稱", value: state.getMe.bot.username ?? null },
                { key: "botName", label: "名稱", value: state.getMe.bot.first_name ?? null },
              ]
            : []),
        ],
        ...(state.getMe.bot ? { details: { bot: state.getMe.bot } } : {}),
      },
      {
        key: "read",
        label: "讀許可權（getChat）",
        success: false,
        error: state.getChat.error,
        items: [{ key: "status", label: "狀態碼", value: state.getChat.status }],
      },
      { key: "write", label: "寫許可權", success: true, skipped: true, note: "TELEGRAM 測試不做真實寫入" },
    ];
    return { success: false, message: "Telegram 測試失敗：bot_token 可用，但 target_chat_id 無法訪問（機器人可能不在該群/頻道）", result: { info, checks } };
  }

  state.getChat.success = true;
  state.getChat.chat = chatRes.json?.result || null;

  const checks = [
    {
      key: "connect",
      label: "連線（getMe）",
      success: true,
      items: [
        ...(state.getMe.bot && typeof state.getMe.bot === "object"
          ? [
              { key: "botId", label: "Bot ID", value: state.getMe.bot.id ?? null },
              { key: "botUsername", label: "使用者名稱", value: state.getMe.bot.username ?? null },
              { key: "botName", label: "名稱", value: state.getMe.bot.first_name ?? null },
            ]
          : []),
      ],
      ...(state.getMe.bot ? { details: { bot: state.getMe.bot } } : {}),
    },
    {
      key: "read",
      label: "讀許可權（getChat）",
      success: true,
      items: [
        ...(state.getChat.chat && typeof state.getChat.chat === "object"
          ? [
              { key: "chatId", label: "Chat ID", value: state.getChat.chat.id ?? null },
              { key: "chatType", label: "型別", value: state.getChat.chat.type ?? null },
              { key: "chatTitle", label: "標題", value: state.getChat.chat.title ?? null },
              { key: "chatUsername", label: "使用者名稱", value: state.getChat.chat.username ?? null },
            ]
          : []),
      ],
      ...(state.getChat.chat ? { details: { chat: state.getChat.chat } } : {}),
    },
    { key: "write", label: "寫許可權", success: true, skipped: true, note: "TELEGRAM 測試不做真實寫入" },
  ];

  return { success: true, message: "Telegram 測試成功（bot_token + target_chat_id 均可用）", result: { info, checks } };
}

export default { telegramTestConnection };
