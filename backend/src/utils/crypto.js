/**
 * 加密相關工具函式
 */

import { sha256 } from "hono/utils/crypto";
import { ValidationError } from "../http/errors.js";
// 匯入Node.js的crypto模組以解決ESM環境中的引用錯誤
import crypto from "crypto";
// 為Node.js環境提供Web Crypto API的相容層
import { webcrypto } from "crypto";
// 如果環境中沒有全域性crypto物件，將webcrypto賦值給全域性
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

/**
 * base64 編碼工具（相容 Node / 瀏覽器 / Workers）
 */
const base64EncodeBytes = (bytes) => {
  // Node 環境：優先用 Buffer，穩定且效能好
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  // Web/Worker 環境：把 bytes 轉成二進位制字串，再 btoa
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64DecodeToBytes = (base64) => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(String(base64), "base64"));
  }

  const bin = atob(String(base64));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
};

const base64EncodeUtf8 = (text) => {
  const encoder = new TextEncoder();
  return base64EncodeBytes(encoder.encode(String(text)));
};

const base64DecodeUtf8 = (base64) => {
  const decoder = new TextDecoder("utf-8");
  const bytes = base64DecodeToBytes(base64);
  return decoder.decode(bytes);
};

/**
 * 生成密碼雜湊
 * @param {string} password - 原始密碼
 * @returns {Promise<string>} 密碼雜湊
 */
export async function hashPassword(password) {
  // 使用SHA-256雜湊
  return await sha256(password);
}

/**
 * 驗證密碼
 * @param {string} plainPassword - 原始密碼
 * @param {string} hashedPassword - 雜湊後的密碼
 * @returns {Promise<boolean>} 驗證結果
 */
export async function verifyPassword(plainPassword, hashedPassword) {
  // 如果是SHA-256雜湊（用於初始管理員密碼）
  if (hashedPassword.length === 64) {
    const hashedInput = await sha256(plainPassword);
    return hashedInput === hashedPassword;
  }

  // 預設比較
  return plainPassword === hashedPassword;
}

/**
 * 加密敏感配置
 * @param {string} value - 需要加密的值
 * @param {string} secret - 加密金鑰
 * @returns {Promise<string>} 加密後的值
 */
export async function encryptValue(value, secret) {
  // 簡單的加密方式
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const secretKey = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  const signature = await crypto.subtle.sign("HMAC", secretKey, data);
  const signatureB64 = base64EncodeBytes(new Uint8Array(signature));
  const payloadB64 = base64EncodeUtf8(value);
  const encryptedValue = `encrypted:${signatureB64}:${payloadB64}`;

  return encryptedValue;
}

/**
 * 解密敏感配置
 * @param {string} encryptedValue - 加密後的值
 * @param {string} secret - 加密金鑰
 * @returns {Promise<string>} 解密後的值
 */
export async function decryptValue(encryptedValue, secret) {
  // 檢查是否為加密值
  if (encryptedValue === undefined || encryptedValue === null) {
    // 容錯：未提供值時按原樣返回，避免空值觸發執行時錯誤
    return encryptedValue;
  }
  if (typeof encryptedValue !== "string") {
    // 非字串直接返回（保持向後相容，不在此拋錯）
    return encryptedValue;
  }
  if (!encryptedValue.startsWith("encrypted:")) {
    return encryptedValue; // 未加密的值直接返回
  }

  // 從加密格式中提取值
  const parts = encryptedValue.split(":");
  if (parts.length !== 3) {
    throw new ValidationError("無效的加密格式");
  }

  try {
    // 直接從加密值中提取原始值
    const originalValue = base64DecodeUtf8(parts[2]);
    return originalValue;
  } catch (error) {
    throw new ValidationError("解密失敗: " + error.message);
  }
}

/**
 * 對金鑰進行掩碼展示
 * @param {string|null|undefined} secret
 * @param {number} visibleTail 顯示尾部多少位
 * @returns {string|null|undefined}
 */
export function maskSecret(secret, visibleTail = 4) {
  if (!secret || typeof secret !== "string") return secret;
  if (secret.length <= visibleTail) return "*".repeat(Math.max(0, secret.length));
  return "*".repeat(secret.length - visibleTail) + secret.slice(-visibleTail);
}

/**
 * 如是加密格式則解密，否則直返原值（相容歷史明文）
 * @param {string|null|undefined} value
 * @param {string} encryptionSecret
 * @returns {Promise<string|null|undefined>}
 */
export async function decryptIfNeeded(value, encryptionSecret) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  return await decryptValue(value, encryptionSecret);
}

/**
 * 生成前端可控的金鑰展示物件
 * @param {object} cfg 原始配置物件（包含金鑰欄位）
 * @param {string} encryptionSecret
 * @param {{mode:'none'|'masked'|'plain'}} options
 * @returns {Promise<object>} 帶金鑰欄位處理後的物件
 */
export async function buildSecretView(cfg, encryptionSecret, options = { mode: "none" }) {
  const mode = options.mode || "none";
  const result = { ...cfg };

  // 統一的 secret 欄位集合
  // - S3: access_key_id / secret_access_key
  // - WebDAV: password
  // - OneDrive/GoogleDrive: client_secret / refresh_token
  // - Telegram: bot_token
  // - GitHub: token
  // - HuggingFace: hf_token
  const SECRET_FIELDS = [
    "access_key_id",
    "secret_access_key",
    "password",
    "client_secret",
    "refresh_token",
    "bot_token",
    "token",
    "hf_token",
  ];

  if (mode === "none") {
    for (const key of SECRET_FIELDS) {
      delete result[key];
    }
    return result;
  }
  if (mode === "masked") {
    for (const key of SECRET_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
      result[key] = maskSecret(await decryptIfNeeded(cfg[key], encryptionSecret));
    }
    return result;
  }
  if (mode === "plain") {
    for (const key of SECRET_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
      result[key] = await decryptIfNeeded(cfg[key], encryptionSecret);
    }
    return result;
  }
  return result;
}
