/* 同步引擎冒烟测试：离线打分 → 回网合并 → 双写冲突 → 越权回绝 → 确认计入 → 失败重试 → 锁定/重开 */
import { setActivePinia, createPinia } from "pinia";

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k)
};

const { useReviewStore } = await import("../src/stores/review");
const { readLedger, writeLedger } = await import("../src/stores/ledger");

setActivePinia(createPinia());
const s = useReviewStore() as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failed++;
}
const V = (site: number) => ({ site, program: 80, structure: 70, sustain: 60 });

// 1) 断网打分写意见：暂存本机，不入台账
s.setOnline(false);
s.submit("a", V(90), "断网时写的评审意见", false);
check("离线提交后标记待同步", s.pendingCount === 1);
check("离线时台账为空", Object.keys(readLedger().docs).length === 0);
check("离线同步直接失败且草稿保留", (await s.syncNow()) === false && s.pendingCount === 1 && !!s.lastError);

// 2) 回网按方案合并
s.setOnline(true);
await sleep(600);
check("回网自动合并，待同步清零", s.pendingCount === 0);
check("台账按方案入账", readLedger().docs["a"]?.entries["评委-林策"]?.values.site === 90);

// 3) 同一项两边都改：本机离线改 + 台账被另一设备改 → 回网留两版等确认
s.setOnline(false);
s.recalled("a");
s.submit("a", V(50), "本机二次修改", false);
const led = readLedger();
led.docs["a"].entries["评委-林策"].values.site = 10;
led.docs["a"].entries["评委-林策"].comment = "另一台设备的版本";
led.docs["a"].entries["评委-林策"].version += 1;
writeLedger(led);
s.setOnline(true);
await sleep(600);
check("双写产生待确认冲突", s.conflicts.length === 1);
check("冲突分不计入有效评委数", s.validJudgeCount("a") === 0);

// 4) 越权确认他人冲突 → 直接回绝
s.setViewer("评委-周筑");
check("越权确认被回绝", s.confirmConflict(s.conflicts[0].id, "local") === false);
check("回绝记入台账动态", s.events[0].action === "越权修改已回绝");
check("回绝后冲突仍在", s.conflicts.length === 1);

// 5) 本人确认保留本机版本 → 覆盖台账并重新计入
s.setViewer("评委-林策");
check("本人确认成功", s.confirmConflict(s.conflicts[0].id, "local") === true);
await sleep(600);
check("确认后台账采用本机版本", readLedger().docs["a"].entries["评委-林策"].values.site === 50);
check("确认后重新计入有效评委数", s.validJudgeCount("a") === 1);

// 6) 两人提交同一方案：各自入账互不覆盖
s.setViewer("评委-周筑");
s.submit("a", V(70), "周筑对 a 的意见", false);
await sleep(600);
check("两位评委的评分都保留", readLedger().docs["a"].entries["评委-周筑"]?.values.site === 70 && readLedger().docs["a"].entries["评委-林策"]?.values.site === 50);
check("有效评委数立即重算为 2", s.validJudgeCount("a") === 2);

// 7) 利益冲突声明不计入
s.submit("b", V(80), "方案 b 意见", true);
await sleep(600);
check("声明利益冲突不计入有效评委数", s.validJudgeCount("b") === 0);

// 8) 锁定 → 名次 → 重开只让该方案失效
s.setViewer("评委-林策");
s.submit("b", V(60), "林策对 b 的意见", false);
s.submit("c", V(88), "林策对 c 的意见", false);
s.setViewer("评委-周筑");
s.submit("c", V(92), "周筑对 c 的意见", false);
await sleep(600);
s.setViewer("主办方");
check("主办方看不到未锁定方案分值", s.visibleScores.length === 0);
check("全部锁定发布", s.publish() === true);
check("锁定后名次算出且 c 第一", s.ranking.length === 3 && s.ranking[0].code === "S-03");
check("锁定后主办方可见分值", s.visibleScores.length > 0);
const before = s.ranking.map((r: any) => r.code);
check("重开只让该方案结果失效", s.reopenScheme("b") === true && s.ranking.length === 2 && !s.ranking.some((r: any) => r.code === "S-02"));
check("其余方案名次不变", s.ranking.every((r: any) => before.includes(r.code)));
check("评委不能重开方案", (s.setViewer("评委-林策"), s.reopenScheme("c") === false));

// 9) 重开后评委改分 → 有效数与名次立即重算
s.recalled("b");
s.submit("b", V(100), "重开后改分", false);
check("改分后有效评委数立即重算", s.validJudgeCount("b") === 1);

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
