<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NTable, NTag, useMessage } from "naive-ui";
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

function lockOne(schemeId: string) {
  const result = store.lockScheme(schemeId);
  if (result.ok) message.success("该方案结果已锁定发布");
  else message.warning(result.error ?? "无法锁定");
}
function reopenOne(schemeId: string) {
  store.reopen(schemeId);
  message.info("该方案结果已失效，可重新评分；其余方案名次不受影响");
}
function lockAll() {
  store.publish();
  if (store.allLocked) message.success("评分结果已全部锁定发布");
  else message.warning("仍有方案未齐备，已跳过未完成的方案");
}
function drillOverstep() {
  const result = store.drillOverstep();
  if (result.ok) message.error(`已回绝：${result.error}`);
  else message.warning(result.error);
}
function drillRemote() {
  const result = store.drillRemoteEdit();
  if (result.ok) message.success("已模拟他方终端改分，回网合并时将出现两版冲突");
  else message.warning(result.error ?? "操作失败");
}
function retryAll() {
  store.retryFlush().then((result) => {
    if (result?.ok) message.success("已重试合并，本地草稿未丢失");
  });
}
</script>
<template>
  <NAlert v-if="!store.allLocked" type="warning" show-icon>结果尚未全部锁定。为避免影响独立判断，主办方当前只能看到提交进度，看不到任何评分值。</NAlert>
  <NAlert v-if="store.online === false" type="info" show-icon>当前断网：评委评分保存在本机，回网后自动按方案合并。</NAlert>
  <div class="result-grid">
    <NCard title="提交进度与分方案锁定">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div>
          <b>{{ scheme.code }} {{ scheme.title }}</b>
          <small>{{ store.judges.filter((judge) => store.scores.some((score) => score.schemeId === scheme.id && score.judge === judge && score.submitted)).length }} / {{ store.judges.length }} 已提交 · {{ store.isSchemeLocked(scheme.id) ? "已锁定" : "未锁定" }}</small>
        </div>
        <div class="row-actions">
          <NTag :type="store.allSubmittedFor(scheme.id) ? 'success' : 'warning'">{{ store.allSubmittedFor(scheme.id) ? "齐备" : "待提交" }}</NTag>
          <NButton v-if="!store.isSchemeLocked(scheme.id)" size="small" type="primary" ghost :disabled="!store.allSubmittedFor(scheme.id)" @click="lockOne(scheme.id)">锁定本方案</NButton>
          <NButton v-else size="small" type="warning" ghost @click="reopenOne(scheme.id)">重开本方案</NButton>
        </div>
      </article>
    </NCard>
    <NCard title="评分纪律">
      <div class="discipline">
        <p>评委只能查看和修改自己的评分；越权修改他人评分会被直接回绝。</p>
        <p>主办方在锁定前无法读取任何分值；合并冲突未确认的评分不计入有效评委数与名次。</p>
        <p>断网时评分写本机草稿，回网后按方案合并；合并失败草稿保留、可重试。</p>
        <p>重开某方案只让该方案自己的结果失效，其他方案名次保持不变。</p>
      </div>
      <NButton type="primary" block :disabled="store.allLocked" @click="lockAll">锁定并发布全部结果</NButton>
      <NButton block style="margin-top:8px" @click="retryAll">重试全部合并</NButton>
      <div class="drill-box">
        <small>台账演练</small>
        <NButton size="small" block @click="drillOverstep">评委越权改他人评分（应被回绝）</NButton>
        <NButton size="small" block style="margin-top:6px" @click="drillRemote">模拟他方终端改分（触发两版冲突）</NButton>
      </div>
    </NCard>
  </div>
  <NCard title="实时排名（评分改动后立即重算）" class="ranking">
    <NEmpty v-if="store.ranking.length === 0" description="锁定后查看最终排名" />
    <NTable v-else :columns="columns" :data="store.ranking.map((item, index) => ({ ...item, rank: index + 1 }))" :bordered="false" />
  </NCard>
  <NCard title="台账动态" class="events">
    <NEmpty v-if="store.events.length === 0" description="暂无动态" />
    <article v-for="event in store.events.slice(0, 12)" :key="event.id" class="event-row">
      <b>{{ event.action }}</b><span>{{ event.detail }}</span><small>{{ new Date(event.time).toLocaleString("zh-CN") }} · {{ event.actor }}</small>
    </article>
  </NCard>
</template>
