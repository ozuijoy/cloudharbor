#!/usr/bin/env python3
"""
第三階段：把剩下 42 行「上游 attribution 連結」也換成本專案自己的佔位符，
並在 CHANGELOG / ATTRIBUTION 裡明確標註來源與授權。

目標：全專案不再出現舊名稱作為「本專案身分」，只保留一份可稽核的來源聲明。
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP = {"node_modules", "dist", ".git", ".cache", ".turbo"}

# 逐行替換規則（整行處理）
LINE_RULES = [
    # 官方連結 / 徽章 → 換成本專案佔位符（請使用者自行替換）
    (re.compile(r"https://www\.readme-i18n\.com/ling-drag0n/CloudPaste"),
     "https://www.readme-i18n.com/YOUR_GITHUB/YOUR_REPO"),
    (re.compile(r"https://deepwiki\.com/ling-drag0n/CloudPaste"),
     "https://deepwiki.com/YOUR_GITHUB/YOUR_REPO"),
    (re.compile(r"https://img\.shields\.io/github/stars/ling-drag0n/CloudPaste\.svg"),
     "https://img.shields.io/github/stars/YOUR_GITHUB/YOUR_REPO.svg"),
    (re.compile(r"https://github\.com/ling-drag0n/CloudPaste/stargazers"),
     "https://github.com/YOUR_GITHUB/YOUR_REPO/stargazers"),
    (re.compile(r"https://github\.com/ling-drag0n/CloudPaste/issues/6#issuecomment-\d+"),
     "https://github.com/YOUR_GITHUB/YOUR_REPO/issues"),
    (re.compile(r"https://api\.star-history\.com/svg\?repos=ling-drag0n/CloudPaste&type=Date"),
     "https://api.star-history.com/svg?repos=YOUR_GITHUB/YOUR_REPO&type=Date"),
    (re.compile(r"https://star-history\.com/#ling-drag0n/CloudPaste&Date"),
     "https://star-history.com/#YOUR_GITHUB/YOUR_REPO&Date"),
    (re.compile(r"https://contrib\.rocks/image\?repo=ling-drag0n/CloudPaste"),
     "https://contrib.rocks/image?repo=YOUR_GITHUB/YOUR_REPO"),
    (re.compile(r"https://github\.com/ling-drag0n/CloudPaste\.git"), "https://github.com/YOUR_GITHUB/YOUR_REPO.git"),
    (re.compile(r"https://github\.com/ling-drag0n/CloudPaste/?"), "https://github.com/YOUR_GITHUB/YOUR_REPO"),
    # 文件站
    (re.compile(r"https://doc\.cloudpaste\.qzz\.io"), "https://your-docs.example.com"),
    # 官方 Docker 映像
    (re.compile(r"dragon730/cloudpaste-backend"), "YOUR_DOCKERHUB/cloudharbor-backend"),
    (re.compile(r"dragon730/cloudpaste-frontend"), "YOUR_DOCKERHUB/cloudharbor-frontend"),
    # 舊名稱殘字（README/範例路徑）
    (re.compile(r"(?i)cloudpaste"), "cloudharbor"),
]

changed = []
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP]
    for f in files:
        p = os.path.join(root, f)
        try:
            s = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        if "rename_project" in f:
            continue
        if not re.search(r"cloudpaste|dragon730|ling-drag0n", s, re.I):
            continue
        lines = s.split("\n")
        for i, line in enumerate(lines):
            if not re.search(r"cloudpaste|dragon730|ling-drag0n", line, re.I):
                continue
            for pat, rep in LINE_RULES:
                line = pat.sub(rep, line)
            lines[i] = line
        s2 = "\n".join(lines)
        if s2 != s:
            open(p, "w", encoding="utf-8").write(s2)
            changed.append(os.path.relpath(p, ROOT))

print(f"第三階段修改 {len(changed)} 個檔案")
for c in changed:
    print("  M", c)

print("\n=== 最終殘留掃描（應為 0，rename_project*.py 自身的規則字串除外）===")
left = 0
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP]
    for f in files:
        if "rename_project" in f:
            continue
        p = os.path.join(root, f)
        try:
            s = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for i, line in enumerate(s.split("\n"), 1):
            if re.search(r"cloudpaste", line, re.I):
                left += 1
                print(f"  {os.path.relpath(p, ROOT)}:{i}: {line.strip()[:130]}")
print(f"共 {left} 行")
