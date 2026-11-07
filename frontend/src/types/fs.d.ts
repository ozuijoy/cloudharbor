import type { PaginationInfo } from "./api";

export interface FsDirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isVirtual?: boolean;
  size?: number | null;
  size_source?: "storage" | "index" | "compute" | "none" | null;
  modified?: string | null;
  modified_source?: "storage" | "index" | "compute" | "none" | null;
  mimetype?: string;
  mount_id?: string | number | null;
  storage_type?: string | null;
  type?: number;
  typeName?: string;
}

export interface FsResolvedMeta {
  headerMarkdown?: string | null;
  footerMarkdown?: string | null;
  hidePatterns: string[];
}

export interface FsDirectoryResponse {
  path: string;
  items: FsDirectoryItem[];
  isVirtual?: boolean;
  mount_id?: string | number;
  dirEtag?: string;
  // 目錄分頁（遊標模式）：主要用於上游分頁介面
  hasMore?: boolean;
  nextCursor?: string | null;
  total?: number;
  pagination?: PaginationInfo;
  meta?: FsResolvedMeta | null;
}
