import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Criterion, LedgerRecord, ReviewEvent, Scheme, ScoreRecord, ScoreVersion, Viewer } from "../types";

const KEY = "pair-wise-yf-48/review";
const LEDGER_KEY = "pair-wise-yf-48/ledger";
const judges: Viewer[] = ["评委-林策", "评委-周筑"];
const seedSchemes: Scheme[] = [
  { id: "a", code: "S-01", title: "潮间带公共客厅", synopsis: "通过退台屋面把社区活动引向水岸，底层保留可被潮水短暂侵入的公共空间。", publicNo: "投递号 7182", status: "待评分" },
  { id: "b", code: "S-02", title: "风廊共生院", synopsis: "以双庭院组织低能耗社区中心，利用贯穿体量连接既有街巷。", publicNo: "投递号 6610", status: "待评分" },
  { id: "c", code: "S-03", title: "折线工坊", synopsis: "保留旧修理厂桁架，置入可拆装工坊和培训空间。", publicNo: "投递号 8024", status: "待评分" }
];
const criteria: Criterion[] = [
  { id: "site", name: "场地回应", description: "与气候、地貌和周边公共空间的关系", weight: 30, max: 100 },
  { id: "program", name: "功能组织", description: "空间组织、流线和公共性", weight: 25, max: 100 },
  { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性", weight: 25, max: 100 },
  { id: "sustain", name: "环境策略", description: "节能、碳排和长期维护", weight: 20, max: 100 }
];

function emptyScore(judge: Viewer, schemeId: string): ScoreRecord {
  return {
    id: `${judge}-${schemeId}`, judge, schemeId,
    values: Object.fromEntries(criteria.map((item) => [item.id, 60])),
    comment: "", submitted: false, conflict: false,
    updatedAt: new Date().toISOString(),
    sync: "pending", dirty: false, base: null, remote: null, lastError: null
  };
}

function toVersion(rec: ScoreRecord | LedgerRecord): ScoreVersion {
  return { values: { ...rec.values }, comment: rec.comment, conflict: rec.conflict, submitted: rec.submitted, updatedAt: rec.updatedAt };
}

/** 内容比对（不含 updatedAt 元数据） */
function versionEquals(a: ScoreVersion, b: ScoreVersion): boolean {
  return a.comment === b.comment && a.conflict === b.conflict && a.submitted === b.submitted
    && criteria.every((item) => a.values[item.id] === b.values[item.id]);
}

function applyVersion(rec: ScoreRecord, ver: ScoreVersion) {
  rec.values = { ...ver.values };
  rec.comment = ver.comment;
  rec.conflict = ver.conflict;
  rec.submitted = ver.submitted;
  rec.updatedAt = ver.updatedAt;
}

function toLedger(rec: ScoreRecord): LedgerRecord {
  return {
    id: rec.id, judge: rec.judge, schemeId: rec.schemeId,
    values: { ...rec.values }, comment: rec.comment, conflict: rec.conflict,
    submitted: rec.submitted, updatedAt: rec.updatedAt
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ledgerRead(): { records: LedgerRecord[] } {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '{"records":[]}');
  } catch {
    return { records: [] };
  }
}

function ledgerWrite(state: { records: LedgerRecord[] }) {
  localStorage.setItem(LEDGER_KEY, JSON.stringify(state));
}

export const useReviewStore = defineStore("review", () => {
  const saved = localStorage.getItem(KEY);
  const initial = saved ? JSON.parse(saved) : { scores: [], events: [], schemeStatuses: {}, locked: {} };
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme, status: initial.schemeStatuses?.[scheme.id] ?? scheme.status })));
  const scores = ref<ScoreRecord[]>(initial.scores ?? []);
  const events = ref<ReviewEvent[]>(initial.events ?? []);
  const locked = ref<Record<string, boolean>>(initial.locked ?? {});
  /** 网络开关：断网时只写本机草稿，回网后自动合并 */
  const online = ref(true);
  /** 一次性故障模拟：武装后下一次合并失败，本地草稿保留 */
  const armFailure = ref(false);
  const syncing = ref(false);

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => viewer.value.startsWith("评委-") ? viewer.value : null);
  /** 主办方锁定前看不到任何分值：主办方视图一律不返回评分 */
  const visibleScores = computed(() => isOrganizer.value ? [] : scores.value.filter((score) => score.judge === judge.value));
  const allLocked = computed(() => schemes.value.every((scheme) => locked.value[scheme.id]));

  function log(action: string, detail: string) {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
  }

  function isSchemeLocked(schemeId: string) {
    return !!locked.value[schemeId];
  }

  function record(schemeId: string): ScoreRecord | null {
    const currentJudge = judge.value;
    if (!currentJudge) return null;
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId);
      scores.value.push(item);
    }
    return item;
  }

  /** 权限闸：评委只能写本人的评分，越权直接回绝 */
  function assertOwner(rec: ScoreRecord | null) {
    if (!rec) throw new Error("记录不存在");
    if (isOrganizer.value) throw new Error("已回绝：主办方不能填写或修改评分");
    if (rec.judge !== judge.value) throw new Error("已回绝：评委只能修改本人的评分，不能改动他人评分");
  }

  function writeLocal(rec: ScoreRecord, values: Record<string, number>, comment: string, conflict: boolean, submitted: boolean): boolean {
    assertOwner(rec);
    rec.values = { ...values };
    rec.comment = comment;
    rec.conflict = conflict;
    rec.submitted = submitted;
    rec.updatedAt = new Date().toISOString();
    rec.dirty = true;
    rec.sync = "pending";
    rec.lastError = null;
    const scheme = schemes.value.find((entry) => entry.id === rec.schemeId);
    if (scheme && scheme.status === "待评分") scheme.status = "评分中";
    if (scheme) scheme.status = allSubmittedFor(rec.schemeId) ? "已提交" : "评分中";
    log(submitted ? "提交评分" : "保存评分草稿", `${scheme?.code ?? rec.schemeId}${conflict ? "，声明利益冲突" : ""}${online.value ? "" : "（断网，草稿存本机）"}`);
    if (online.value) {
      if (armFailure.value) {
        armFailure.value = false;
        rec.sync = "failed";
        rec.lastError = "网络中断，合并失败；本地草稿已保留，未丢失";
        log("合并失败·草稿保留", `${scheme?.code ?? rec.schemeId}：本地草稿已留住，可重试`);
        return true;
      }
      void flush();
    }
    return false;
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const rec = record(schemeId);
    if (!rec || rec.submitted || isSchemeLocked(schemeId)) return { ok: false, error: "当前方案已锁定或已提交" };
    try {
      const failed = writeLocal(rec, values, comment, conflict, false);
      return { ok: true, failed };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const rec = record(schemeId);
    if (!rec || isSchemeLocked(schemeId)) return { ok: false, error: "当前方案已锁定" };
    try {
      const failed = writeLocal(rec, values, comment, conflict, true);
      return { ok: true, failed };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  function recalled(schemeId: string) {
    const rec = record(schemeId);
    if (!rec || isSchemeLocked(schemeId)) return;
    try {
      assertOwner(rec);
    } catch (error) {
      log("回绝越权修改", (error as Error).message);
      return;
    }
    rec.submitted = false;
    rec.updatedAt = new Date().toISOString();
    rec.dirty = true;
    rec.sync = "pending";
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme) scheme.status = "评分中";
    log("退回评分修改", scheme?.code ?? schemeId);
    if (online.value) void flush();
  }

  function allSubmittedFor(schemeId: string) {
    return judges.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && score.submitted));
  }

  /** 回网合并：按方案逐条三向合并。
   *  - 仅本机改过 → 本机版写入台账
   *  - 仅台账改过 → 拉取台账版
   *  - 两边都改过 → 保留两版（conflict），等待确认，确认前不计入排名
   *  - 合并失败 → 本地草稿原样保留（failed），可重试
   *  同步期间的新修改会排队，当前一轮结束后自动再合并，不会丢改动。
   */
  let flushQueued = false;
  async function flush() {
    if (syncing.value) {
      flushQueued = true;
      return { ok: false, error: "正在同步，已排队" };
    }
    syncing.value = true;
    try {
      do {
        flushQueued = false;
        for (const rec of scores.value.filter((item) => item.dirty && item.sync !== "conflict")) {
          const scheme = schemes.value.find((entry) => entry.id === rec.schemeId);
          const code = scheme?.code ?? rec.schemeId;
          if (!online.value) {
            rec.sync = "pending";
            continue;
          }
          await delay(450);
          const ledger = ledgerRead();
          const remote = ledger.records.find((entry) => entry.id === rec.id);
          if (!remote) {
            ledger.records.push(toLedger(rec));
            ledgerWrite(ledger);
            rec.base = toVersion(rec);
            rec.sync = "synced";
            rec.lastError = null;
            log("同步共享台账", `${code}：本机评分已上传`);
          } else {
            const base = rec.base;
            const localChanged = !base || !versionEquals(toVersion(rec), base);
            const remoteChanged = !base || !versionEquals(remote, base);
            if (localChanged && remoteChanged) {
              rec.sync = "conflict";
              rec.remote = { ...remote };
              log("合并冲突·两版待确认", `${code}：本机与台账都改了同一项，已保留两版`);
            } else if (localChanged) {
              const index = ledger.records.findIndex((entry) => entry.id === rec.id);
              ledger.records[index] = toLedger(rec);
              ledgerWrite(ledger);
              rec.base = toVersion(rec);
              rec.sync = "synced";
              rec.lastError = null;
              log("同步共享台账", `${code}：本机修改已合并`);
            } else if (remoteChanged) {
              applyVersion(rec, remote);
              rec.base = toVersion(remote);
              rec.sync = "synced";
              log("同步共享台账", `${code}：台账更新已拉取到本机`);
            } else {
              rec.sync = "synced";
            }
          }
        }
      } while (flushQueued);
      return { ok: true };
    } finally {
      syncing.value = false;
    }
  }

  /** 冲突确认：选定保留哪一版，确认后该评分才计入有效评委数与名次 */
  function resolveConflict(schemeId: string, keep: "local" | "remote") {
    const rec = record(schemeId);
    if (!rec || rec.sync !== "conflict" || !rec.remote) return { ok: false, error: "没有待确认的冲突" };
    try {
      assertOwner(rec);
    } catch (error) {
      log("回绝越权修改", (error as Error).message);
      return { ok: false, error: (error as Error).message };
    }
    if (keep === "local") {
      rec.base = { ...rec.remote };
    } else {
      applyVersion(rec, rec.remote);
      rec.base = { ...rec.remote };
    }
    rec.remote = null;
    rec.sync = "pending";
    rec.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    log("冲突已确认", `${scheme?.code ?? schemeId}：已保留${keep === "local" ? "本机版" : "台账版"}，评分恢复计入`);
    if (online.value) void flush();
    return { ok: true };
  }

  function retryFlush() {
    armFailure.value = false;
    return flush();
  }

  function setOnline(value: boolean) {
    online.value = value;
    if (value) {
      void flush();
    } else {
      scores.value.forEach((rec) => {
        if (rec.dirty && rec.sync !== "conflict") rec.sync = "pending";
      });
    }
  }

  /** 主办方锁定某方案并发布其结果 */
  function lockScheme(schemeId: string) {
    if (!allSubmittedFor(schemeId)) return { ok: false, error: "仍有评委未提交，不能锁定" };
    locked.value[schemeId] = true;
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme) scheme.status = "已锁定";
    log("锁定方案·结果发布", scheme?.code ?? schemeId);
    return { ok: true };
  }

  /** 重开某方案：只让该方案自己的结果失效，其他方案不受影响 */
  function reopen(schemeId: string) {
    locked.value[schemeId] = false;
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme) scheme.status = "评分中";
    log("重开方案·本方案结果失效", `${scheme?.code ?? schemeId}：仅该方案结果失效，其余方案名次保持不变`);
  }

  function publish() {
    schemes.value.forEach((scheme) => {
      if (allSubmittedFor(scheme.id) && !locked.value[scheme.id]) lockScheme(scheme.id);
    });
  }

  /** 实时排名：评分一改动立即重算；合并冲突未确认的不计入；只含已锁定方案 */
  const ranking = computed(() => {
    return schemes.value
      .filter((scheme) => locked.value[scheme.id])
      .map((scheme) => {
        const rows = scores.value.filter((score) => score.schemeId === scheme.id && score.submitted && !score.conflict && score.sync !== "conflict");
        const total = rows.length
          ? rows.reduce((sum, row) => sum + criteria.reduce((value, criterion) => value + row.values[criterion.id] * criterion.weight / 100, 0), 0) / rows.length
          : 0;
        return {
          ...scheme,
          total: Number(total.toFixed(2)),
          judgeCount: rows.length,
          conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length
        };
      })
      .sort((a, b) => b.total - a.total);
  });

  /** 演练：当前评委试图改写他人评分，台账直接回绝 */
  function drillOverstep(): { ok: boolean; error: string } {
    const other = judges.find((name) => name !== judge.value);
    if (!other) return { ok: false, error: "当前身份不是评委" };
    const scheme = schemes.value[0];
    let rec = scores.value.find((item) => item.judge === other && item.schemeId === scheme.id);
    if (!rec) {
      rec = emptyScore(other, scheme.id);
      scores.value.push(rec);
    }
    try {
      writeLocal(rec, { ...rec.values }, `${rec.comment}（越权篡改）`, rec.conflict, rec.submitted);
      return { ok: false, error: "拦截未生效" };
    } catch (error) {
      log("回绝越权修改", `${scheme.code}：${judge.value} 试图修改 ${other} 的评分，已回绝`);
      return { ok: true, error: (error as Error).message };
    }
  }

  /** 演练：另一台终端修改了台账版本，本机回网合并时将触发两版冲突 */
  function drillRemoteEdit(): { ok: boolean; error?: string } {
    if (isOrganizer.value || !judge.value) return { ok: false, error: "主办方没有本人评分" };
    const scheme = schemes.value[0];
    const rec = record(scheme.id);
    if (!rec || !rec.dirty) return { ok: false, error: "请先在本机填写并保存该方案评分" };
    const ledger = ledgerRead();
    const remote = ledger.records.find((entry) => entry.id === rec.id);
    if (!remote) return { ok: false, error: "台账中还没有该评分，请先同步到共享台账" };
    remote.values = { ...remote.values, site: Math.min(100, remote.values.site + 5) };
    remote.comment = `${remote.comment}（他方终端修订）`;
    remote.updatedAt = new Date().toISOString();
    ledgerWrite(ledger);
    log("他方终端已改台账", `${scheme.code}：另一台终端更新了台账版本，本机合并时将出现两版冲突`);
    return { ok: true };
  }

  function setViewer(value: Viewer) {
    viewer.value = value;
  }

  watch([scores, events, schemes, locked], () => {
    localStorage.setItem(KEY, JSON.stringify({
      scores: scores.value,
      events: events.value,
      schemeStatuses: Object.fromEntries(schemes.value.map((scheme) => [scheme.id, scheme.status])),
      locked: locked.value
    }));
  }, { deep: true });

  return {
    viewer, schemes, criteria, judges, scores, events, online, armFailure, syncing,
    locked, allLocked, published: allLocked,
    isOrganizer, judge, visibleScores, ranking,
    setViewer, record, saveDraft, submit, recalled, allSubmittedFor,
    flush, retryFlush, setOnline, resolveConflict, isSchemeLocked,
    lockScheme, reopen, publish, drillOverstep, drillRemoteEdit
  };
});
