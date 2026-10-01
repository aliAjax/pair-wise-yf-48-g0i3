import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { ConflictItem, Criterion, ReviewEvent, Scheme, ScoreRecord, ScoreVersion, Viewer } from "../types";
import { LEDGER_KEY, latency, readLedger, writeLedger } from "./ledger";

const KEY = "pair-wise-yf-48/review";
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

interface PersistedState {
  scores?: Array<Partial<ScoreRecord>>;
  events?: ReviewEvent[];
  conflicts?: ConflictItem[];
  online?: boolean;
  lastSyncAt?: string | null;
  published?: boolean;
  schemeStatuses?: Record<string, Scheme["status"]>;
}

function emptyScore(judge: Viewer, schemeId: string): ScoreRecord {
  return { id: `${judge}-${schemeId}`, judge, schemeId, values: Object.fromEntries(criteria.map((item) => [item.id, 60])), comment: "", submitted: false, conflict: false, updatedAt: new Date().toISOString(), version: 0, dirty: false, conflictPending: false };
}

function snapshot(source: ScoreVersion): ScoreVersion {
  return { values: { ...source.values }, comment: source.comment, conflict: source.conflict, submitted: source.submitted, updatedAt: source.updatedAt };
}

export const useReviewStore = defineStore("review", () => {
  const saved = localStorage.getItem(KEY);
  const initial: PersistedState = saved ? JSON.parse(saved) : {};
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme, status: initial.published ? "已锁定" : initial.schemeStatuses?.[scheme.id] ?? scheme.status })));
  const scores = ref<ScoreRecord[]>((initial.scores ?? []).map((item) => ({ version: 0, dirty: true, conflictPending: false, ...item }) as ScoreRecord));
  const events = ref<ReviewEvent[]>(initial.events ?? []);
  const conflicts = ref<ConflictItem[]>(initial.conflicts ?? []);
  const online = ref<boolean>(initial.online ?? true);
  const flaky = ref(false);
  const syncing = ref(false);
  const lastSyncAt = ref<string | null>(initial.lastSyncAt ?? null);
  const lastError = ref<string | null>(null);

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => (viewer.value.startsWith("评委-") ? viewer.value : null));
  const published = computed(() => schemes.value.every((scheme) => scheme.status === "已锁定"));
  const pendingCount = computed(() => scores.value.filter((score) => score.dirty).length);
  /** 主办方在方案锁定前看不到任何分值；评委只能看到自己的评分 */
  const visibleScores = computed(() => isOrganizer.value ? scores.value.filter((score) => lockedScheme(score.schemeId)) : scores.value.filter((score) => score.judge === judge.value));

  function lockedScheme(schemeId: string) {
    return schemes.value.find((scheme) => scheme.id === schemeId)?.status === "已锁定";
  }

  function log(action: string, detail: string) {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
    if (events.value.length > 120) events.value.length = 120;
  }

  function record(schemeId: string) {
    const currentJudge = judge.value;
    if (!currentJudge) return null;
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId);
      scores.value.push(item);
    }
    return item;
  }

  /** 越权守卫：任何修改/确认他人评分的行为直接回绝并记入台账动态 */
  function guardOwn(owner: Viewer, action: string) {
    if (judge.value === owner) return true;
    log("越权修改已回绝", `${viewer.value} 试图${action} ${owner} 的评分`);
    return false;
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const item = record(schemeId);
    if (!item || item.submitted || item.conflictPending || lockedScheme(schemeId)) return;
    if (!guardOwn(item.judge, "修改")) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.dirty = true;
    item.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme && scheme.status === "待评分") scheme.status = "评分中";
    log("保存评分草稿", `${scheme?.code ?? schemeId}${conflict ? "，声明利益冲突" : ""}${online.value ? "" : "（离线，待回网合并）"}`);
    autoSync();
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    const item = record(schemeId);
    if (!item || item.conflictPending || lockedScheme(schemeId)) return;
    if (!guardOwn(item.judge, "提交")) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.submitted = true;
    item.dirty = true;
    item.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme) scheme.status = allSubmittedFor(schemeId) ? "已提交" : "评分中";
    log("提交评分", `${scheme?.code ?? schemeId}${online.value ? "" : "（离线，待回网合并）"}`);
    autoSync();
  }

  function recalled(schemeId: string) {
    const item = record(schemeId);
    if (!item || lockedScheme(schemeId)) return;
    if (!guardOwn(item.judge, "退回")) return;
    item.submitted = false;
    item.dirty = true;
    item.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme && scheme.status === "已提交") scheme.status = "评分中";
    log("退回评分修改", scheme?.code ?? schemeId);
    autoSync();
  }

  function allSubmittedFor(schemeId: string) {
    return judges.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && score.submitted));
  }

  function weightedOf(values: Record<string, number>) {
    return criteria.reduce((sum, criterion) => sum + (values[criterion.id] ?? 0) * criterion.weight / 100, 0);
  }

  /** 有效评分：已提交、未声明利益冲突、无待确认冲突；任何改动都会触发重算 */
  function validScoresFor(schemeId: string) {
    return scores.value.filter((score) => score.schemeId === schemeId && score.submitted && !score.conflict && !score.conflictPending);
  }

  function validJudgeCount(schemeId: string) {
    return validScoresFor(schemeId).length;
  }

  function pendingConflictsFor(schemeId: string) {
    return conflicts.value.filter((item) => item.schemeId === schemeId);
  }

  /** 名次随评分改动实时重算；只公布已锁定方案，同分并列 */
  const ranking = computed(() => {
    const rows = schemes.value
      .filter((scheme) => scheme.status === "已锁定")
      .map((scheme) => {
        const valid = validScoresFor(scheme.id);
        const total = valid.length ? valid.reduce((sum, row) => sum + weightedOf(row.values), 0) / valid.length : 0;
        return { ...scheme, total: Number(total.toFixed(2)), judgeCount: valid.length, conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length };
      })
      .sort((a, b) => b.total - a.total);
    let rank = 0;
    let previous: number | null = null;
    return rows.map((row, index) => {
      if (previous === null || row.total < previous) rank = index + 1;
      previous = row.total;
      return { ...row, rank };
    });
  });

  function lockScheme(schemeId: string) {
    if (!isOrganizer.value) {
      log("越权操作已回绝", `${viewer.value} 试图锁定方案结果`);
      return false;
    }
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (!scheme || scheme.status === "已锁定") return false;
    if (!allSubmittedFor(schemeId) || pendingConflictsFor(schemeId).length) return false;
    scheme.status = "已锁定";
    log("锁定方案结果", `${scheme.code} 名次已定，有效评委 ${validJudgeCount(schemeId)} 人`);
    return true;
  }

  function publish() {
    if (!isOrganizer.value) {
      log("越权操作已回绝", `${viewer.value} 试图锁定并发布结果`);
      return false;
    }
    const ready = schemes.value.every((scheme) => scheme.status === "已锁定" || (allSubmittedFor(scheme.id) && !pendingConflictsFor(scheme.id).length));
    if (!ready) return false;
    schemes.value.forEach((scheme) => {
      if (scheme.status !== "已锁定") scheme.status = "已锁定";
    });
    log("锁定并发布结果", `${schemes.value.length} 个匿名方案`);
    return true;
  }

  /** 重开只让该方案自己的结果失效，其余方案的锁定名次不受影响 */
  function reopenScheme(schemeId: string) {
    if (!isOrganizer.value) {
      log("越权操作已回绝", `${viewer.value} 试图重开方案`);
      return false;
    }
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (!scheme || scheme.status !== "已锁定") return false;
    scheme.status = allSubmittedFor(schemeId) ? "已提交" : "评分中";
    log("重开方案", `${scheme.code} 原结果失效，其余方案名次不受影响`);
    return true;
  }

  function setOnline(value: boolean) {
    if (online.value === value) return;
    online.value = value;
    log(value ? "恢复在线" : "进入离线", value ? "开始把本机修改按方案合并到共享台账" : "评分与意见暂存本机，回网后合并");
    if (value) void syncNow();
  }

  function autoSync() {
    if (online.value && !syncing.value) void syncNow();
  }

  /**
   * 回网后按方案合并：仅本机改过的直接入账，仅台账改过的拉回本机；
   * 同一项两边都改过则保留两版等本人确认，确认前不计入排名。
   * 合并失败时本地草稿（dirty 标记）原样保留，可再次重试。
   */
  async function syncNow(): Promise<boolean> {
    if (syncing.value) return false;
    if (!online.value) {
      lastError.value = "当前离线：修改已保存在本机";
      return false;
    }
    syncing.value = true;
    lastError.value = null;
    try {
      await latency(flaky.value ? 800 : 320);
      if (flaky.value && Math.random() < 0.5) throw new Error("flaky network");
      const ledger = readLedger();
      let pushed = 0;
      let pulled = 0;
      let conflicted = 0;
      let ledgerChanged = false;
      for (const scheme of schemes.value) {
        const dirtyEntries = scores.value.filter((score) => score.schemeId === scheme.id && score.dirty && !score.conflictPending);
        let doc = ledger.docs[scheme.id];
        if (!doc) {
          if (!dirtyEntries.length) continue;
          doc = ledger.docs[scheme.id] = { schemeId: scheme.id, version: 0, updatedAt: new Date().toISOString(), entries: {} };
          ledgerChanged = true;
        }
        let docChanged = false;
        for (const entry of Object.values(doc.entries)) {
          const local = scores.value.find((score) => score.judge === entry.judge && score.schemeId === scheme.id);
          if (!local) {
            scores.value.push({ id: `${entry.judge}-${scheme.id}`, judge: entry.judge, schemeId: scheme.id, ...snapshot(entry), version: entry.version, dirty: false, conflictPending: false });
            pulled++;
          } else if (local.dirty && !local.conflictPending && entry.version !== local.version) {
            conflicts.value.push({ id: crypto.randomUUID(), schemeId: scheme.id, judge: entry.judge, local: snapshot(local), remote: snapshot(entry), remoteVersion: entry.version, createdAt: new Date().toISOString() });
            local.conflictPending = true;
            local.dirty = false;
            conflicted++;
            log("合并冲突待确认", `${scheme.code} · ${entry.judge} 的同一项评分两边都改过，已保留两版`);
          } else if (local.dirty && !local.conflictPending) {
            const version = entry.version + 1;
            doc.entries[entry.judge] = { judge: entry.judge, ...snapshot(local), version };
            local.version = version;
            local.dirty = false;
            docChanged = true;
            pushed++;
          } else if (!local.dirty && !local.conflictPending && entry.version !== local.version) {
            Object.assign(local, snapshot(entry));
            local.version = entry.version;
            pulled++;
          }
        }
        for (const local of dirtyEntries) {
          if (!local.dirty || local.conflictPending || doc.entries[local.judge]) continue;
          const version = 1;
          doc.entries[local.judge] = { judge: local.judge, ...snapshot(local), version };
          local.version = version;
          local.dirty = false;
          docChanged = true;
          pushed++;
        }
        if (docChanged) {
          doc.version++;
          doc.updatedAt = new Date().toISOString();
          ledgerChanged = true;
        }
      }
      if (ledgerChanged) writeLedger(ledger);
      lastSyncAt.value = new Date().toISOString();
      if (pushed || pulled || conflicted) log("台账合并完成", `上传 ${pushed} 条 · 拉回 ${pulled} 条${conflicted ? ` · ${conflicted} 项冲突待确认` : ""}`);
      return true;
    } catch {
      lastError.value = "合并失败：本地草稿已保留，可重试";
      log("合并失败", "本地草稿保留，等待重试");
      return false;
    } finally {
      syncing.value = false;
    }
  }

  /** 确认冲突版本：只能由评分本人操作，确认后分值立即重新计入 */
  function confirmConflict(conflictId: string, keep: "local" | "remote") {
    const item = conflicts.value.find((entry) => entry.id === conflictId);
    if (!item) return false;
    if (!guardOwn(item.judge, "确认")) return false;
    const local = scores.value.find((score) => score.judge === item.judge && score.schemeId === item.schemeId);
    if (!local) {
      conflicts.value = conflicts.value.filter((entry) => entry.id !== conflictId);
      return false;
    }
    if (keep === "local") {
      Object.assign(local, snapshot(item.local));
      local.version = item.remoteVersion;
      local.dirty = true;
    } else {
      Object.assign(local, snapshot(item.remote));
      local.version = item.remoteVersion;
      local.dirty = false;
    }
    local.conflictPending = false;
    conflicts.value = conflicts.value.filter((entry) => entry.id !== conflictId);
    const code = schemes.value.find((scheme) => scheme.id === item.schemeId)?.code ?? item.schemeId;
    log("冲突已确认", `${code} · ${item.judge} ${keep === "local" ? "保留本机版本" : "采用台账版本"}，分值重新计入`);
    autoSync();
    return true;
  }

  function setViewer(value: Viewer) {
    viewer.value = value;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => setOnline(true));
    window.addEventListener("offline", () => setOnline(false));
    window.addEventListener("storage", (event) => {
      if (event.key === LEDGER_KEY) autoSync();
    });
  }

  // 启动时把本机遗留的未同步修改合并进台账
  if (online.value && scores.value.some((score) => score.dirty)) void syncNow();

  watch([scores, events, schemes, conflicts, online, lastSyncAt], () => {
    localStorage.setItem(KEY, JSON.stringify({
      scores: scores.value,
      events: events.value,
      conflicts: conflicts.value,
      online: online.value,
      lastSyncAt: lastSyncAt.value,
      schemeStatuses: Object.fromEntries(schemes.value.map((scheme) => [scheme.id, scheme.status]))
    }));
  }, { deep: true });

  return {
    viewer, schemes, criteria, judges, scores, events, conflicts, published, ranking, visibleScores,
    online, flaky, syncing, lastSyncAt, lastError, pendingCount,
    isOrganizer, judge, setViewer, record, saveDraft, submit, recalled, publish, allSubmittedFor,
    weightedOf, validJudgeCount, pendingConflictsFor, lockScheme, reopenScheme,
    setOnline, syncNow, confirmConflict
  };
});
