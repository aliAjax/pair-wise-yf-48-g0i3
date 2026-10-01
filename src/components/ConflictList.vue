<script setup lang="ts">
import { computed } from "vue";
import { NAlert, NButton, NCard, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";
import type { ConflictItem, ScoreVersion } from "../types";

const store = useReviewStore();
const message = useMessage();

const mine = computed(() => store.conflicts.filter((item) => item.judge === store.judge));
const others = computed(() => store.conflicts.filter((item) => item.judge !== store.judge));

function schemeCode(schemeId: string) {
  return store.schemes.find((item) => item.id === schemeId)?.code ?? schemeId;
}
function weighted(version: ScoreVersion) {
  return store.weightedOf(version.values).toFixed(1);
}
function fmt(time: string) {
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}
function confirm(item: ConflictItem, keep: "local" | "remote") {
  if (store.confirmConflict(item.id, keep)) message.success("冲突已确认，有效评委数与名次已重算");
  else message.error("已回绝：不能修改其他评委的评分");
}
</script>

<template>
  <NCard v-if="store.conflicts.length" title="待确认冲突" class="conflict-card">
    <NAlert type="warning" show-icon :bordered="false">同一项评分在本机和台账两边都改过，两版都已保留；确认前该分不计入有效评委数与名次。</NAlert>
    <article v-for="item in mine" :key="item.id" class="conflict">
      <header><b>{{ schemeCode(item.schemeId) }} · {{ item.judge }}</b><NTag size="small" type="warning">两版待确认</NTag></header>
      <div class="conflict-versions">
        <div class="version-box">
          <small>本机版本 · {{ fmt(item.local.updatedAt) }}</small>
          <b>{{ weighted(item.local) }} 分</b>
          <p>{{ item.local.comment || "（无意见）" }}</p>
          <NTag v-if="item.local.conflict" size="tiny" type="warning">已声明利益冲突</NTag>
          <NButton size="small" type="primary" @click="confirm(item, 'local')">保留本机版本</NButton>
        </div>
        <div class="version-box">
          <small>台账版本 · {{ fmt(item.remote.updatedAt) }}</small>
          <b>{{ weighted(item.remote) }} 分</b>
          <p>{{ item.remote.comment || "（无意见）" }}</p>
          <NTag v-if="item.remote.conflict" size="tiny" type="warning">已声明利益冲突</NTag>
          <NButton size="small" @click="confirm(item, 'remote')">采用台账版本</NButton>
        </div>
      </div>
    </article>
    <article v-for="item in others" :key="item.id" class="conflict">
      <header><b>{{ schemeCode(item.schemeId) }} · {{ item.judge }}</b><NTag size="small">等待本人确认</NTag></header>
      <p class="others-hint">分值与意见仅本人可见，需 {{ item.judge }} 亲自确认；越权代为确认会被直接回绝并记录。</p>
      <NButton size="small" quaternary @click="confirm(item, 'local')">代为确认（越权，将被回绝）</NButton>
    </article>
  </NCard>
</template>
