#!/usr/bin/env python3
"""
CloudHarbor 專案重命名腳本（原專案已停止維護）

功能
  1. 文字替換：處理所有拼寫變體 CloudHarbor / cloudharbor / CloudHarbor / CloudHarbor
     （含變數名 CloudHarborLightTheme、localStorage 鍵、CSS class、User-Agent、資料庫檔名等）
  2. 檔名重命名：cloudharbor.svg、CloudHarbor-Proxy.js、.idea/cloudharbor.iml
  3. 白名單保護：不動「上游官方資源」的引用
     （GitHub 原倉庫、官方 Docker Hub 映像、官方文件站、Cloudflare 既有資源名），
     這些改了會導致 CI/CD 找不到既有資源或連到不存在的頁面。

用法
  python3 rename_project.py --name cloudharbor --check     # 只檢查可用的新名稱
  python3 rename_project.py --name cloudharbor --dry-run   # 試跑，列出將修改的檔案
  python3 rename_project.py --name cloudharbor --apply     # 實際修改
"""
import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP_DIRS = {"node_modules", "dist", ".git", ".cache", ".turbo"}

# 舊名稱的所有拼寫變體（駝峰形式要放在前，避免被小寫形式先吃掉）
OLD_NAMES = ["CloudHarbor", "CloudHarbor", "CloudHarbor", "cloudharbor"]

# 受保護片段：命中則「不替換」
KEEP_PATTERNS = [
    # 上游官方連結（改了會指向不存在的頁面）
    r"github\.com/[A-Za-z0-9_.-]+/CloudHarbor",
    r"readme-i18n\.com/[A-Za-z0-9_.-]+/CloudHarbor",
    r"deepwiki\.com/[A-Za-z0-9_.-]+/CloudHarbor",
    r"star-history\.com",
    r"api\.star-history\.com",
    r"contrib\.rocks/image\?repo=[A-Za-z0-9_.-]+/CloudHarbor",
    r"doc\.cloudharbor\.qzz\.io",
    # 上游官方 Docker 映像（本專案自己的映像名稱見 build-*.yml，可自行決定）
    r"dragon730/cloudpaste-",
    # Cloudflare 既有資源名稱（D1 資料庫 / Pages 專案 / Worker）
    r'cloudharbor-(db|spa|frontend|backend)',
]

FILES_TO_RENAME = {
    "frontend/public/cloudharbor.svg": "frontend/public/{slug}.svg",
    "CloudHarbor-Proxy.js": "Cloudharbor-Proxy.js",
    ".idea/cloudharbor.iml": ".idea/{slug}.iml",
}


# 已知的詞彙表：用於把 cloudharbor 這種「沒有分隔符」的名字切成 Cloud + Harbor
KNOWN_WORDS = [
    "cloud", "harbor", "vault", "hub", "nest", "wave", "paste", "share", "drive",
    "box", "boxx", "drop", "store", "storage", "file", "files", "link", "links",
    "nest", "port", "dock", "deck", "nest", "seat", "ship", "sync", "node", "bay",
]


def split_words(token: str):
    """把單一 token 依已知詞彙貪婪切分（無法切分時整段視為一個詞）"""
    t = token.lower()
    words, i = [], 0
    while i < len(t):
        for w in sorted(KNOWN_WORDS, key=len, reverse=True):
            if t.startswith(w, i):
                words.append(w)
                i += len(w)
                break
        else:
            words.append(t[i:])
            i += 1
    return words


def variant(base: str):
    """cloud-harbor / cloudharbor -> (CloudHarbor, cloudharbor)"""
    parts = []
    for chunk in re.split(r"[-_ ]+", base):
        if not chunk:
            continue
        parts.extend(split_words(chunk))
    # 若切分結果只是把原字串拆碎（無法辨識的詞），就退回整段當一個詞
    if "".join(parts) != re.sub(r"[-_ ]+", "", base).lower() or len(parts) > 3:
        parts = [re.sub(r"[-_ ]+", "", base).lower()]
    pascal = "".join(p[:1].upper() + p[1:] for p in parts if p)
    lower = "".join(p.lower() for p in parts)
    return pascal, lower


def is_protected(ctx: str, patterns) -> bool:
    return any(re.search(p, ctx) for p in patterns)


def _replace(text: str, old: str, new: str, patterns) -> str:
    if old not in text:
        return text
    out, idx = [], 0
    while True:
        pos = text.find(old, idx)
        if pos == -1:
            out.append(text[idx:])
            break
        ctx = text[max(0, pos - 140): pos + len(old) + 140]
        if is_protected(ctx, patterns):
            out.append(text[idx: pos + len(old)])
        else:
            out.append(text[idx:pos] + new)
        idx = pos + len(old)
    return "".join(out)


def transform(content: str, pascal: str, lower: str, patterns) -> str:
    out = content
    for old in OLD_NAMES:
        if old == "cloudharbor":
            new = lower
        else:
            new = pascal
        out = _replace(out, old, new, patterns)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="新專案名（slug），例如 cloudharbor")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    g.add_argument("--check", action="store_true", help="檢查名稱是否可用（GitHub / npm）")
    args = ap.parse_args()

    pascal, lower = variant(args.name)
    if args.check:
        import json, urllib.request

        def get(url):
            try:
                with urllib.request.urlopen(url, timeout=15) as r:
                    return json.loads(r.read().decode())
            except Exception as e:
                return {"__error__": str(e)}

        gh = get(f"https://api.github.com/search/repositories?q={lower}+in:name&per_page=3")
        npm = get(f"https://registry.npmjs.org/{lower}")
        print(f"名稱：{pascal} / {lower}")
        if "__error__" in gh:
            print("  GitHub 查詢失敗（可能被限流）:", gh["__error__"])
        else:
            print(f"  GitHub 同名倉庫數：{gh.get('total_count')}",
                  [i["full_name"] for i in gh.get("items", [])[:3]])
        print("  npm 套件名：", "已被佔用" if "name" in npm else "可用")
        return

    patterns = [re.compile(p) for p in KEEP_PATTERNS]
    changed_files, protected = [], []

    # 1) 內容替換
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            p = os.path.join(root, f)
            if os.path.basename(p) in FILES_TO_RENAME:
                continue  # 稍後連檔名一起處理
            try:
                s = open(p, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            if not any(o in s for o in OLD_NAMES):
                continue
            new = transform(s, pascal, lower, patterns)
            rel = os.path.relpath(p, ROOT)
            if new != s:
                changed_files.append(rel)
                if args.apply:
                    open(p, "w", encoding="utf-8").write(new)
            if any(o.lower() in new.lower() for o in OLD_NAMES):
                protected.append(rel)

    # 2) 檔名重命名（內容同時替換）
    renamed = []
    for old_rel, new_tpl in FILES_TO_RENAME.items():
        old_abs = os.path.join(ROOT, old_rel)
        if not os.path.exists(old_abs):
            continue
        new_rel = new_tpl.format(slug=lower, pascal=pascal)
        new_abs = os.path.join(ROOT, new_rel)
        renamed.append((old_rel, new_rel))
        if args.apply:
            s = open(old_abs, encoding="utf-8").read()
            open(new_abs, "w", encoding="utf-8").write(transform(s, pascal, lower, patterns))
            os.remove(old_abs)

    mode = "（試跑，未寫入）" if args.dry_run else "（已套用）"
    print(f"新名稱：{pascal} / {lower} {mode}")
    print(f"\n【內容已替換的檔案】{len(changed_files)}")
    for c in changed_files:
        print("  M", c)
    print(f"\n【重新命名的檔案】{len(renamed)}")
    for a, b in renamed:
        print(f"  R {a}  ->  {b}")
    print(f"\n【保留上游名稱、需人工確認的檔案】{len(protected)}")
    for c in protected:
        print("  ?", c)


if __name__ == "__main__":
    main()
