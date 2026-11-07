#!/usr/bin/env python3
"""
第二階段：處理「白名單誤攔」的殘留（這些不是上游連結，而是本專案自己的識別字被誤判為
Cloudflare 資源名 cloudharbor-backend/frontend/db/spa 而保留下來）。

處理原則：
  - 本專案自己的東西 → 改名（Docker 標籤、container name、network、image、字面字串、
    「開發Worker」示範 URL、Cloudflare 資源名）
  - 指向「上游原作者/官方」的 URL（github.com/ling-drag0n/...、doc.cloudpaste.qzz.io、
    dragon730/...）→ 保留，並由使用者與原作者 attribution 一併決定
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP_DIRS = {"node_modules", "dist", ".git", ".cache", ".turbo"}
NEW = "CloudHarbor"
SLUG = "cloudharbor"

# 這一輪要處理的殘留（全部是「本專案自己的識別字」）
RULES = [
    (r"cloudharbor-backend", "cloudharbor-backend"),
    (r"cloudharbor-frontend", "cloudharbor-frontend"),
    (r"cloudharbor-spa", "cloudharbor-spa"),
    (r"cloudharbor-db", "cloudharbor-db"),
    (r"cloudharbor-network", "cloudharbor-network"),
    (r"/cloudharbor\.svg", "/cloudharbor.svg"),
    ("cloudharbor-frontend-simulation", "cloudharbor-frontend-simulation"),
]

# 仍要保留的「上游」引用
KEEP = [
    re.compile(r"github\.com/ling-drag0n/"),
    re.compile(r"doc\.cloudharbor\.qzz\.io"),
    re.compile(r"dragon730/"),
    re.compile(r"readme-i18n\.com/"),
    re.compile(r"deepwiki\.com/"),
    re.compile(r"img\.shields\.io/github/stars/"),
    re.compile(r"contrib\.rocks/"),
    re.compile(r"star-history\.com"),
]

changed = []
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in files:
        p = os.path.join(root, f)
        try:
            s = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        orig = s
        lines = s.split("\n")
        for i, line in enumerate(lines):
            if "cloudharbor" not in line.lower():
                continue
            # 整行只要命中任一「上游引用」就跳過該行（保守）
            if any(k.search(line) for k in KEEP):
                continue
            for pat, rep in RULES:
                line = re.sub(pat, rep, line)
            # 剩餘單獨出現的 CloudHarbor / cloudharbor（例如 schema.sql 註解、
            # EnvSwitcher 的示範網址）→ 改名
            line = line.replace("CloudHarbor", NEW).replace("CloudHarbor", NEW)
            line = re.sub(r"(?i)cloudharbor", SLUG, line)
            lines[i] = line
        s = "\n".join(lines)
        if s != orig:
            open(p, "w", encoding="utf-8").write(s)
            changed.append(os.path.relpath(p, ROOT))

print(f"第二階段修改 {len(changed)} 個檔案：")
for c in changed:
    print("  M", c)

# 最終殘留報告
print("\n=== 最終仍保留 cloudharbor 的行（應全部是上游引用）===")
left = 0
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in files:
        p = os.path.join(root, f)
        try:
            s = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for i, line in enumerate(s.split("\n"), 1):
            if re.search(r"cloudharbor", line, re.I):
                left += 1
                print(f"  {os.path.relpath(p, ROOT)}:{i}: {line.strip()[:130]}")
print(f"共 {left} 行")
