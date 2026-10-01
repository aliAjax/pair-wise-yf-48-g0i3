export type Viewer = "评委-林策" | "评委-周筑" | "主办方";
export type SchemeStatus = "待评分" | "评分中" | "已提交" | "已锁定";

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

/** 一个评分版本的内容（本机版 / 台账版共用） */
export interface ScoreVersion {
  values: Record<string, number>;
  comment: string;
  submitted: boolean;
  conflict: boolean;
  updatedAt: string;
}

export interface ScoreRecord extends ScoreVersion {
  id: string;
  judge: Viewer;
  schemeId: string;
  /** 台账中该条目的版本号，0 表示尚未入账 */
  version: number;
  /** 本机有未合并到台账的修改 */
  dirty: boolean;
  /** 存在待确认冲突，确认前分值不计入 */
  conflictPending: boolean;
}

/** 同一项评分两边都改过时保留的两版，等待本人确认 */
export interface ConflictItem {
  id: string;
  schemeId: string;
  judge: Viewer;
  local: ScoreVersion;
  remote: ScoreVersion;
  remoteVersion: number;
  createdAt: string;
}

/** 共享台账中某位评委对某方案的评分条目 */
export interface LedgerEntry extends ScoreVersion {
  judge: Viewer;
  version: number;
}

/** 共享台账按方案存放的文档，整体写入时后到的盖掉先到的 */
export interface LedgerSchemeDoc {
  schemeId: string;
  version: number;
  updatedAt: string;
  entries: Record<string, LedgerEntry>;
}

export interface LedgerState {
  docs: Record<string, LedgerSchemeDoc>;
}

export interface ReviewEvent {
  id: string;
  time: string;
  actor: Viewer;
  action: string;
  detail: string;
}
