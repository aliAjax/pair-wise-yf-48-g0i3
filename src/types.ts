export type Viewer = "评委-林策" | "评委-周筑" | "主办方";
export type SchemeStatus = "待评分" | "评分中" | "已提交" | "已锁定";
export type SyncStatus = "synced" | "pending" | "failed" | "conflict";

export interface Scheme {
  id: string;
  code: string;
  title: string;
  synopsis: string;
  publicNo: string;
  status: SchemeStatus;
}

export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  max: number;
}

/** 评分的一个版本（本机版 / 台账版共用） */
export interface ScoreVersion {
  values: Record<string, number>;
  comment: string;
  conflict: boolean;
  submitted: boolean;
  updatedAt: string;
}

export interface ScoreRecord extends ScoreVersion {
  id: string;
  judge: Viewer;
  schemeId: string;
  /** 与共享台账的同步状态 */
  sync: SyncStatus;
  /** 是否有过实际填写（空占位记录不上传） */
  dirty: boolean;
  /** 三向合并的基准版本（上次同步时的快照） */
  base: ScoreVersion | null;
  /** 合并冲突时台账侧的版本，等待确认 */
  remote: ScoreVersion | null;
  lastError: string | null;
}

/** 共享台账中的评分记录（服务端口径） */
export interface LedgerRecord extends ScoreVersion {
  id: string;
  judge: Viewer;
  schemeId: string;
}

export interface ReviewEvent {
  id: string;
  time: string;
  actor: Viewer;
  action: string;
  detail: string;
}
