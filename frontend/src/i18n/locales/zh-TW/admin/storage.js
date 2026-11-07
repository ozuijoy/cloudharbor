export default {
  storage: {
    // 通用
    item: "此儲存配置",

    // 儲存型別顯示
    type: {
      s3: "S3相容",
      webdav: "WebDAV",
      local: "本機檔案",
      onedrive: "OneDrive",
      googledrive: "Google Drive",
      github_releases: "GitHub Releases",
      github_api: "GitHub API",
      telegram: "Telegram Bot API",
      discord: "Discord Bot API",
      huggingface_datasets: "HuggingFace Datasets",
      mirror: "Source Mirror",
    },

    // 分組標題
    groups: {
      basic: "基礎配置",
      connection: "連線配置",
      credentials: "憑證配置",
      permissions: "許可權設定",
      advanced: "高階選項",
      options: "其他選項",
      behaviour: "行為配置",
    },

    // 通用欄位標籤
    fields: {
      name: "配置名稱",
      storage_type: "儲存型別",
      provider_type: "服務商",
      endpoint_url: "端點 URL",
      bucket_name: "儲存桶名稱",
      region: "區域",
      access_key_id: "訪問金鑰 ID",
      secret_access_key: "訪問金鑰 Secret",
      path_style: "路徑樣式",
      default_folder: "預設上傳目錄",
      custom_host: "自定義 HOST",
      url_proxy: "代理 URL",
      signature_expires_in: "簽名過期時間(秒)",
      is_public: "允許 API 金鑰使用",
      username: "使用者名稱",
      password: "密碼",
      tls_insecure_skip_verify: "跳過 TLS 證書校驗",

      // S3 特有欄位
      s3: {
        multipart_part_size_mb: "分片大小（MB）",
        multipart_concurrency: "分片上傳併發數",
      },

      // LOCAL 特有欄位
      local: {
        root_path: "本地根目錄",
        auto_create_root: "自動建根目錄",
        readonly: "只讀模式",
        enable_disk_usage: "啟用配額讀取",
        trash_path: "回收站路徑",
        dir_permission: "目錄/檔案許可權",
      },

      // OneDrive 特有欄位
      onedrive: {
        region: "區域",
        client_id: "客戶端 ID",
        client_secret: "客戶端金鑰",
        refresh_token: "重新整理令牌",
        token_renew_endpoint: "Token 續期端點",
        redirect_uri: "回撥地址",
        use_online_api: "API 型別",
        enable_disk_usage: "啟用配額讀取",
        oauth_status: "授權狀態",
      },

      // Google Drive 特有欄位
      googledrive: {
        use_online_api: "API 型別",
        endpoint_url: "Token 續期端點",
        client_id: "客戶端 ID",
        client_secret: "客戶端金鑰",
        refresh_token: "重新整理令牌 / Service Account JSON 遠端 URL",
        root_id: "根目錄 ID",
        enable_disk_usage: "啟用配額讀取",
        enable_shared_view: "SharedWithMe檢視",
      },

      // WebDAV 特有欄位（補充：上游配額開關）
      webdav: {
        enable_disk_usage: "啟用配額讀取",
      },

      // GitHub Releases 特有欄位
      github_releases: {
        repo_structure: "倉庫對映規則",
        show_all_version: "顯示所有版本目錄",
        show_source_code: "顯示 Source code 壓縮包",
        show_readme: "顯示 README / LICENSE",
        show_release_notes: "顯示 Release Notes",
        per_page: "每次拉取的版本數量",
        gh_proxy: "GitHub 代理 URL",
        token: "GitHub 訪問令牌",
      },

      // GitHub API（倉庫內容）特有欄位
      github_api: {
        owner: "倉庫所有者（owner）",
        repo: "倉庫名稱（repo）",
        ref: "引用（ref）",
        endpoint_url: "GitHub API Base",
        gh_proxy: "GitHub 代理 URL",
        committer_name: "提交者姓名（committer.name）",
        committer_email: "提交者郵箱（committer.email）",
        author_name: "作者姓名（author.name）",
        author_email: "作者郵箱（author.email）",
        token: "GitHub 訪問令牌",
      },

      // Telegram 特有欄位
      telegram: {
        bot_token: "Bot Token",
        target_chat_id: "目標頻道/群 Chat ID",
        endpoint_url: "Bot API 地址",
        bot_api_mode: "Bot API 模式",
        part_size_mb: "分片大小（MB）",
        upload_concurrency: "上傳併發",
        verify_after_upload: "上傳後校驗",
      },

      // Discord 特有欄位
      discord: {
        bot_token: "Bot Token",
        channel_id: "頻道 ID（Channel ID）",
        endpoint_url: "API Base URL（可選）",
        part_size_mb: "分片大小（MB）",
        upload_concurrency: "上傳併發",
      },

      // HuggingFace Datasets 特有欄位
      huggingface_datasets: {
        repo: "資料集倉庫（repo）",
        revision: "分支/版本（revision）",
        endpoint_url: "Hub 地址（可選）",
        hf_token: "HF Token（可選）",
        hf_use_paths_info: "顯示更多資訊（修改時間 / Xet / LFS）",
        hf_tree_limit: "列目錄每頁數量（tree limit）",
        hf_multipart_concurrency: "分片上傳併發數",
        hf_use_xet: "使用 Xet 儲存後端（預設關閉）",
        hf_delete_lfs_on_remove: "刪除檔案時，同時清理 HuggingFace LFS 大檔案（謹慎）",
      },

      // MIRROR（映象站）
      mirror: {
        preset: "映象模板",
        endpoint_url: "映象站地址",
        max_entries: "最大條目數",
      },
    },

    // 佔位符文字
    placeholder: {
      bucket_name: "例如：my-bucket",
      endpoint_url: "例如：https://s3.region.amazonaws.com",
      region: "例如：us-east-1 或留空",
      access_key_id: "輸入訪問金鑰 ID",
      secret_access_key: "輸入訪問金鑰 Secret",
      default_folder: "例如：uploads/ 或留空表示上傳到根目錄",
      custom_host: "例如：https://cdn.example.com",
      url_proxy: "例如：https://proxy.example.com",
      webdav_endpoint: "例如：https://dav.example.com/dav",
      username: "輸入 WebDAV 使用者名稱",
      password: "輸入 WebDAV 密碼",
      root_path: "例如：/data/storage 或 D:\\Storage",
      trash_path: "例如：.trash 或 /data/trash",
      dir_permission: "例如：0777",

      // OneDrive 佔位符
      onedrive: {
        client_id: "Azure 應用的客戶端 ID",
        client_secret: "Azure 應用的客戶端金鑰",
        refresh_token: "在外部授權頁面獲取的重新整理令牌",
        token_renew_endpoint: "例如：https://your-token-service.com/renew",
        redirect_uri: "例如：https://your-token-service.com/onedrive/callback",
      },

      // Google Drive 佔位符
      googledrive: {
        endpoint_url: "例如：https://your-online-api.example.com/refresh",
        client_id: "Google OAuth 客戶端 ID",
        client_secret: "Google OAuth 客戶端金鑰",
        refresh_token: "RefreshToken 或 Service Account JSON 的遠端 URL",
        root_id: "例如：root 或某個 Shared Drive ID",
      },

      // GitHub Releases 佔位符
      github_releases: {
        repo_structure:
          "每行一條：owner/repo、別名:owner/repo 或完整倉庫 URL（https://github.com/owner/repo），例如：owner/repo 或 別名:owner/repo 或 https://github.com/owner/repo",
        gh_proxy: "例如：https://gh-proxy.com/https://github.com",
        token: "建議填寫個人訪問令牌以提升速率上限",
      },

      // GitHub API 佔位符
      github_api: {
        owner: "例如：ling-drag0n",
        repo: "例如：CloudHarbor",
        ref: "例如：main、v1.0.0 或 40 位 commit sha（留空使用預設分支）",
        endpoint_url: "例如：https://api.github.com（留空使用預設值）",
        gh_proxy: "例如：https://ghproxy.net/https://raw.githubusercontent.com（可選，僅影響直鏈輸出）",
        committer_name: "例如：CloudHarbor Bot（可選）",
        committer_email: "{'例如：bot@example.com（可選）'}",
        author_name: "例如：Your Name（可選）",
        author_email: "{'例如：you@example.com（可選）'}",
        token: "必填：建議使用具有倉庫讀寫許可權的訪問令牌",
      },

      telegram: {
        bot_token: "貼上從 ＠BotFather 拿到的 token（形如 123:ABC...）",
        target_chat_id: "例如：-100xxxxxxxxxx（必須是純數字）",
        bot_api_mode: "預設使用官方",
        endpoint_url: "例如：https://api.telegram.org（自建 Bot API server 可改為你的地址）",
        part_size_mb: "預設 15；未勾選自建時建議 ≤20；勾選自建可不限制",
        upload_concurrency: "預設 2；調大更快但更容易被限流",
      },

      discord: {
        bot_token: "貼上 Discord Bot Token",
        channel_id: "目標頻道的 Channel ID",
        endpoint_url: "例如：https://discord.com/api/v10（預設官方；需要走代理/反代時再改）",
        part_size_mb: "預設 10；建議 8~10（Discord 單次上傳限制最大10MB，Nitro使用者最大25MB）",
        upload_concurrency: "預設 1；調大更快但更容易觸發 Discord 限速",
      },

      huggingface_datasets: {
        repo: "例如：Open-Orca/OpenOrca（不要寫成完整 URL）",
        revision: "例如：main（分支名）；也可以填 tag/commit，但那樣只能讀不能寫",
        endpoint_url: "預設 https://huggingface.co；自建映象/代理時才需要改",
        hf_token: "可選：從 https://huggingface.co/settings/tokens 建立；private/gated 必填",
        hf_tree_limit: "預設 100；數值越大單次返回越多",
        hf_multipart_concurrency: "預設 5；數值越大越快，但更吃網路/更容易失敗",
      },

      mirror: {
        endpoint_url: "例如：https://mirrors.tuna.tsinghua.edu.cn/",
        max_entries: "例如：1000",
      },
    },

    // 列舉選項
    enum: {
      mirror: {
        preset: {
          tuna: "Tsinghua",
          ustc: "USTC",
          aliyun: "Aliyun",
        },
      },
      telegram: {
        bot_api_mode: {
          official: "官方（api.telegram.org）",
          self_hosted: "自建 Bot API Server",
        },
      },
    },

    toggle: {
      telegram: {
        bot_api_mode: "使用自建 Bot API Server",
      },
    },

    // 描述文字
    description: {
      endpoint_url: "S3 相容服務的終端節點地址，不同服務商格式略有差異",
      path_style: "啟用後使用路徑樣式(endpoint/bucket)訪問，禁用則使用虛擬主機(bucket.endpoint)",
      signature_expires_in: "預簽名 URL 的有效期，單位為秒，預設 3600",
      custom_host: "用於生成公開訪問連結的自定義域名（CDN 加速等場景）",
      url_proxy: "透過代理伺服器訪問儲存，適用於需要中轉的場景",
      s3: {
        multipart_part_size_mb: "前端直傳分片上傳的分片大小（MB）。預設 5MB；分片越大分片數量越少，但單片失敗重傳成本更高。",
        multipart_concurrency: "前端直傳分片上傳併發數（同時上傳多少片）。預設 3；越大速度可能越快，但更吃網路也更容易失敗。",
      },
      webdav_endpoint: "WebDAV 服務的完整訪問地址",
      tls_insecure_skip_verify: "跳過 TLS 證書驗證（不安全，僅用於測試環境）",
      root_path: "本地檔案儲存的根目錄路徑，例如 /data/local-files ",
      auto_create_root: "啟用後，當本地根目錄對應子目錄不存在時會自動建立；預設關閉，需要手動在宿主機上建立子目錄",
      readonly: "啟用只讀模式，禁止寫入和刪除操作",
      local: {
        enable_disk_usage: "啟用後，讀取宿主機磁碟空間總量/已用/可用，用於面板配額分析與上傳限制校驗",
      },
      trash_path: "刪除檔案時移動到此目錄，支援相對路徑（相對於根目錄）或絕對路徑",
      dir_permission: "建立目錄和檔案時使用的許可權",

      // OneDrive 描述
      onedrive: {
        region: "選擇 OneDrive 服務區域，國際版選 Global，世紀互聯版選 CN",
        client_id: "在 Azure Portal 註冊應用後獲取的客戶端 ID",
        client_secret: "Azure 應用的客戶端金鑰",
        refresh_token: "推薦在 OpenList APIPages 等外部授權站點完成授權後，複製重新整理令牌貼上到此處",
        root_folder: "OneDrive 中的預設上傳目錄路徑，留空表示使用整個 OneDrive",
        token_renew_endpoint: "可選：自定義 Token 續期服務地址，用於對接 Online API 等外部續期服務",
        redirect_uri: "外部授權站點在 Azure 應用中配置的回撥地址，通常與授權頁面文件保持一致",
        use_online_api: "啟用後，CloudHarbor 將按照 Online API 協議呼叫續期端點重新整理令牌",
        enable_disk_usage: "啟用後，讀取 OneDrive 的儲存配額資訊（用於面板配額分析與上傳限制校驗）。",
      },

      webdav: {
        enable_disk_usage: "啟用後，嘗試配額屬性讀取 WebDAV 配額資訊，用於面板配額分析與上傳限制校驗（並非所有 WebDAV 服務支援）。",
      },

      // Google Drive 描述
      googledrive: {
        use_online_api: "啟用後，透過線上 API 地址獲取訪問令牌，適合託管在外部的統一 Token 服務。",
        endpoint_url: "線上 API 重新整理地址，呼叫以獲取 access_token 與 refresh_token。",
        client_id: "標準 OAuth 模式下使用的 client_id，可在 GCP 控制檯建立 OAuth 客戶端後獲取。",
        client_secret: "標準 OAuth 模式下使用的 client_secret，用於配合 refresh_token 重新整理 access_token。",
        refresh_token: "可為兩種形態：1) 標準 OAuth refresh_token；2) 遠端 Service Account JSON URL。",
        root_id: "Google Drive 根目錄 ID，預設為 root；如需掛載 Shared Drive，請填寫對應 driveId。",
        enable_disk_usage: "啟用後，讀取儲存配額資訊，用於面板配額分析與上傳限制校驗。",
        enable_shared_view: '啟用後，將在對應掛載根目錄下展示 "Shared with me" 虛擬目錄，用於瀏覽“與我共享”檔案。',
      },

      // GitHub Releases 描述
      github_releases: {
        repo_structure:
          "配置 GitHub 倉庫列表，每行一條。單倉庫可用 owner/repo 直接掛載到倉庫根目錄（不額外生成 repo 目錄）；多倉庫必須使用 別名:owner/repo 生成一級目錄避免覆蓋。掛載路徑本身由掛載配置決定。",
        show_all_version: "開啟後，將為每個版本建立一個子目錄（按 tagName 命名），目錄下包含該版本的所有釋出資產；關閉時只展示最新版本的資產列表。",
        show_source_code: '開啟後，為每個版本額外生成 "Source code (zip)" 和 "Source code (tar.gz)" 偽檔案，指向 GitHub 提供的原始碼壓縮包。',
        show_readme: "在倉庫根目錄掛載 README / LICENSE 虛擬檔案（如果倉庫存在對應檔案），檔案內容透過 GitHub API 實時讀取。",
        show_release_notes: "在版本目錄中額外生成 RELEASE_NOTES.md 虛擬檔案，內容來自 GitHub Release 的說明（Markdown）。",
        per_page: "從 GitHub Releases 介面每次獲取的最大版本數量，預設 20。數值越大，請求次數越少，但單次響應體越大。",
        gh_proxy:
          "可選：用於加速 GitHub 下載的代理字首，例如 https://gh-proxy.com/github.com 或 https://gh-proxy.com/https://github.com 完整填入。僅對以 https://github.com 開頭的下載連結生效。",
        token: "可選：GitHub 個人訪問令牌。用於訪問私有倉庫或提升 API 速率限制（強烈推薦配置，尤其在公開站點中使用時）。",
      },

      // GitHub API 描述
      github_api: {
        owner: "GitHub 倉庫 owner（例如 ling-drag0n）",
        repo: "GitHub 倉庫名稱（例如 CloudHarbor）",
        ref: "可填寫分支名 / 標籤名 / commit sha。僅分支支援寫入；標籤與 commit sha 為只讀。留空時自動使用倉庫預設分支。",
        endpoint_url: "可選：自定義API（用於 GitHub Enterprise 等場景）。預設 https://api.github.com。",
        gh_proxy: "可選：用於加速 raw 直鏈輸出。會把直鏈中的 https://raw.githubusercontent.com 替換為該值。",
        committer_name: "可選：自定義 commit 的 committer.name（與 committer_email 成對填寫）。",
        committer_email: "可選：自定義 commit 的 committer.email（與 committer_name 成對填寫）。",
        author_name: "可選：自定義 commit 的 author.name（與 author_email 成對填寫）。",
        author_email: "可選：自定義 commit 的 author.email（與 author_name 成對填寫）。",
        token: "必填：GitHub 訪問令牌。用於提升 API 速率限制，並用於寫入（建立 commit/更新 refs）。",
      },

      telegram: {
        bot_token: "用於呼叫 Telegram Bot API 上傳/下載檔案",
        target_chat_id: "檔案會被髮送到這個頻道/群（需要把 bot 拉進並授予發訊息許可權）",
        endpoint_url: "預設官方地址；如果你後續自建 Bot API server，可以切到自建地址",
        bot_api_mode: "未勾選自建：按官方 Bot API 規則單次最大上傳大小 ≤20MB ；勾選自建：你自己提供 Bot API Server，可放寬這些限制",
        part_size_mb: "掛載頁斷點續傳的分片大小；預設 15MB。未勾選自建時建議 ≤20MB；勾選自建可不限制",
        upload_concurrency: "限制同一儲存配置同時向 Telegram 發請求的數量，避免併發過高導致限流",
        verify_after_upload: "開啟後每片上傳成功會再次校驗大小，速度稍慢但更穩(無特殊情況預設即可)",
      },

      discord: {
        bot_token: "用於呼叫 Discord Bot API",
        channel_id: "檔案會被上傳到這個頻道（bot 必須在該頻道/伺服器裡，並有檢視/發訊息/上傳附件許可權）",
        endpoint_url: "可選：自定義 Discord API Base（預設 https://discord.com/api/v10）。只有你使用代理/反代/自建閘道器時才需要改；請填到 /api/v10 這一層。",
        part_size_mb: "掛載頁斷點續傳的分片大小；建議 8~10MB（Discord 單次上傳限制最大10MB，Nitro使用者最大25MB）",
        upload_concurrency: "限制同一儲存配置同時向 Discord 發請求的數量，避免併發過高導致 429 限速",
      },

      huggingface_datasets: {
        repo: "HuggingFace 資料集倉庫 ID（形如 owner/name）。這是 HuggingFace Datasets 的“倉庫”，不是本地路徑。",
        revision: "分支/版本：建議填分支名（如 main）。如果填 tag 或 commit sha，只能讀不能寫。",
        endpoint_url: "Hub 站點地址。預設 https://huggingface.co；只有你自建映象/代理時才需要改。",
        hf_token: "可選：用於訪問 private/gated 或提升額度/限流上限。",
        hf_use_paths_info: "開啟後，目錄列表會額外獲取詳細資訊，如：“修改時間 + Xet/LFS 標記”。資訊更全，但響應體更大、也更容易觸發限流。",
        hf_tree_limit: "tree API 每頁返回檔案數量（對應HF的 limit 引數）。配合“顯示更多資訊”開關使用，開啟時最大100數量限制，關閉時最大1000數量限制。預設即可",
        hf_multipart_concurrency: "一次同時上傳多少個分片。數值越大速度越快，但會更吃網路，也更容易失敗（預設 3，建議 3~8）。",
        hf_use_xet: "開啟後，寫入會嘗試走 Xet（新後端）。但某些執行環境（例如 Cloudflare Workers）可能禁止執行時編譯 WebAssembly，導致寫入報錯。預設關閉更穩。",
        hf_delete_lfs_on_remove:
          "開啟後：你在 CloudHarbor 刪除檔案時，會額外請求 HuggingFace，把對應的 LFS 大檔案也一起“永久刪除”（從 HuggingFace 的 “List LFS files” 裡也消失）。\n不開啟：只會刪掉倉庫裡的檔案記錄（類似“指標”），LFS 大檔案可能仍然留在 HF，所以你再次上傳“完全相同內容”的檔案時，可能會出現“秒傳/跳過上傳”。\n注意：如果兩個檔案內容完全一樣（同一個 SHA），清理 LFS 可能會影響另一個檔案或舊版本下載。\n",
      },

      mirror: {
        preset: "自動按照對應模板規則去抓映象站目錄頁連結。",
        endpoint_url: "映象目錄根地址（必須以 http(s):// 開頭）。選了模板後會自動回填，也可以手動改成別的映象站地址。",
        max_entries: "單次列目錄最多返回多少個條目。目錄特別大時建議調小，避免卡頓或超時。",
      },
    },

    // 卡片摘要顯示值
    display: {
      path_style: {
        path: "路徑樣式",
        virtual_host: "虛擬主機樣式",
      },
      default_folder: {
        root: "根目錄",
      },
      onedrive: {
        use_online_api: {
          enabled: "Online API",
          disabled: "標準 API",
        },
      },
      googledrive: {
        use_online_api: {
          enabled: "Online API",
          disabled: "標準 API",
        },
        enable_shared_view: {
          enabled: "已啟用",
          disabled: "未啟用",
        },
      },
    },

    // S3 服務商選項
    s3: {
      provider: {
        cloudflare_r2: "Cloudflare R2",
        backblaze_b2: "Backblaze B2",
        aws_s3: "AWS S3",
        aliyun_oss: "阿里雲 OSS",
        other: "其他S3相容服務",
      },
    },

    // OneDrive 區域選項
    onedrive: {
      region: {
        global: "國際版 (Global)",
        cn: "世紀互聯版 (CN)",
        us: "美國政府版 (US Gov)",
        de: "德國版 (Germany)",
      },
    },
  },
};
