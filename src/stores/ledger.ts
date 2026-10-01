import type { LedgerState } from "../types";

export const LEDGER_KEY = "pair-wise-yf-48/ledger";

/**
 * 共享评审台账（用独立 localStorage 键模拟服务端）。
 * 台账的原始写入语义是“后到的盖掉先到的”：整份方案文档直接被替换。
 * 客户端合并层（review store 的 syncNow）在此之上做版本校验，
 * 发现同一项两边都改过时保留两版等确认，避免被后到写入静默覆盖。
 */
export function readLedger(): LedgerState {
  const raw = localStorage.getItem(LEDGER_KEY);
  if (!raw) return { docs: {} };
  try {
    return JSON.parse(raw) as LedgerState;
  } catch {
    return { docs: {} };
  }
}

export function writeLedger(state: LedgerState) {
  localStorage.setItem(LEDGER_KEY, JSON.stringify(state));
}

/** 模拟网络往返延迟 */
export function latency(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
