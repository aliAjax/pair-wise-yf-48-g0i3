<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NPopconfirm, NTable, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const columns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "利益冲突", key: "conflicts" },
  { title: "加权总分", key: "total" }
];

function schemeCode(schemeId: string) {
  return store.schemes.find((item) => item.id === schemeId)?.code ?? schemeId;
}
function submittedCount(schemeId: string) {
  return store.judges.filter((judge) => store.scores.some((score) => score.schemeId === schemeId && score.judge === judge && score.submitted)).length;
}
function lockable(schemeId: string) {
  return store.allSubmittedFor(schemeId) && !store.pendingConflictsFor(schemeId).length;
}
function lock(schemeId: string) {
  if (store.lockScheme(schemeId)) message.success("方案结果已锁定，名次即时生效");
  else message.warning(store.pendingConflictsFor(schemeId).length ? "存在待确认冲突，确认后才能锁定" : "仍有评委未提交，不能锁定");
}
function reopen(schemeId: string) {
  if (store.reopenScheme(schemeId)) message.warning("已重开：该方案结果失效，其余方案名次不受影响");
}
function publish() {
  if (store.publish()) message.success("评分结果已全部锁定发布");
  else message.warning("仍有评委未提交或冲突未确认，不能锁定");
}
function fmt(time: string) {
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <NAlert v-if="!store.published" type="warning" show-icon class="mb">结果尚未全部锁定。为避免影响独立判断，主办方当前只能看到提交进度与有效评委数，看不到分值。</NAlert>
  <NAlert v-if="store.conflicts.length" type="error" show-icon class="mb">有 {{ store.conflicts.length }} 项评分冲突待确认，确认前不计入有效评委数与名次。</NAlert>
  <div class="result-grid">
    <NCard title="提交进度（评分改动即时重算）">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div>
          <b>{{ scheme.code }} {{ scheme.title }}</b>
          <small>已提交 {{ submittedCount(scheme.id) }} / {{ store.judges.length }} · 有效评委 {{ store.validJudgeCount(scheme.id) }}<template v-if="store.pendingConflictsFor(scheme.id).length"> · {{ store.pendingConflictsFor(scheme.id).length }} 项冲突待确认</template></small>
        </div>
        <div class="row-actions">
          <NTag :type="scheme.status === '已锁定' ? 'success' : scheme.status === '已提交' ? 'info' : 'warning'">{{ scheme.status }}</NTag>
          <template v-if="store.isOrganizer">
            <NButton v-if="scheme.status !== '已锁定'" size="tiny" :disabled="!lockable(scheme.id)" @click="lock(scheme.id)">锁定</NButton>
            <NPopconfirm v-else @positive-click="reopen(scheme.id)">
              <template #trigger><NButton size="tiny" quaternary>重开</NButton></template>
              重开后该方案结果立即失效，其余方案名次不受影响。
            </NPopconfirm>
          </template>
        </div>
      </article>
    </NCard>
    <NCard title="评分纪律">
      <div class="discipline">
        <p>评委只能查看和修改自己的评分，越权修改他人评分会被直接回绝并记录。</p>
        <p>断网可打分写意见，回网后按方案合并；同一项两边都改会保留两版，等本人确认。</p>
        <p>声明利益冲突或冲突待确认的评分保留审计记录，但不计入有效评委数与名次。</p>
        <p>结果按方案锁定；重开某个方案只让该方案自己的结果失效。</p>
      </div>
      <NButton v-if="store.isOrganizer" type="primary" block :disabled="store.published" @click="publish">全部锁定并发布</NButton>
    </NCard>
  </div>
  <NCard title="最终排名" class="ranking"><NEmpty v-if="!store.ranking.length" description="方案锁定后公布名次，同分并列" /><NTable v-else :columns="columns" :data="store.ranking" :bordered="false" /></NCard>
  <NCard v-if="store.visibleScores.length" title="评分明细（按权限可见）" class="breakdown">
    <article v-for="score in store.visibleScores" :key="score.id" class="breakdown-row">
      <div><b>{{ schemeCode(score.schemeId) }} · {{ score.judge }}</b><small>{{ score.comment || "（无意见）" }}</small></div>
      <div class="row-actions">
        <NTag v-if="!score.submitted" size="small">草稿</NTag>
        <NTag v-if="score.conflict" size="small" type="warning">利益冲突</NTag>
        <NTag v-if="score.conflictPending" size="small" type="error">冲突待确认</NTag>
        <NTag v-if="score.dirty" size="small" type="info">待同步</NTag>
        <b>{{ store.weightedOf(score.values).toFixed(1) }}</b>
      </div>
    </article>
  </NCard>
  <NCard title="台账动态" class="event-feed">
    <NEmpty v-if="!store.events.length" description="暂无台账动态" />
    <article v-for="event in store.events.slice(0, 30)" :key="event.id" class="event-row"><small>{{ fmt(event.time) }} · {{ event.actor }}</small><span><b>{{ event.action }}</b> — {{ event.detail }}</span></article>
  </NCard>
</template>
