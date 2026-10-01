<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NRate, NSwitch, NTag, useMessage } from "naive-ui";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useReviewStore } from "../stores/review";
import type { ScoreVersion } from "../types";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });
const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const currentScore = computed(() => store.record(selected.value.id));
const form = reactive({ values: Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>, comment: "", conflict: false });
const schema = toTypedSchema(z.object({ comment: z.string().min(4, "请至少填写4个字的评审意见") }));
const { errors, validate } = useForm({ validationSchema: schema });

function syncForm() {
  const record = store.record(selected.value.id);
  form.values = { ...(record?.values ?? Object.fromEntries(store.criteria.map((item) => [item.id, 60]))) };
  form.comment = record?.comment ?? "";
  form.conflict = record?.conflict ?? false;
}

watch(selectedId, syncForm, { immediate: true });
watch(() => currentScore.value?.updatedAt, () => {
  if (currentScore.value && currentScore.value.sync !== "conflict") syncForm();
});

const weighted = computed(() => store.criteria.reduce((sum, item) => sum + form.values[item.id] * item.weight / 100, 0));
const locked = computed(() => store.isSchemeLocked(selected.value.id));
const disabled = computed(() => store.isOrganizer || currentScore.value?.submitted || locked.value || currentScore.value?.sync === "conflict");

const syncTag = computed(() => {
  if (store.isOrganizer) return null;
  const rec = currentScore.value;
  if (!rec || !rec.dirty) return { label: "未填写", type: "default" as const };
  if (rec.sync === "synced") return { label: "已同步共享台账", type: "success" as const };
  if (rec.sync === "pending") return { label: store.online ? "待同步" : "断网·草稿存本机", type: "warning" as const };
  if (rec.sync === "failed") return { label: "合并失败·草稿保留", type: "error" as const };
  return { label: "合并冲突·两版待确认", type: "error" as const };
});

function versionWeighted(ver: ScoreVersion | null) {
  if (!ver) return "0.0";
  return store.criteria.reduce((sum, item) => sum + ver.values[item.id] * item.weight / 100, 0).toFixed(1);
}
function versionTime(ver: ScoreVersion | null) {
  if (!ver) return "";
  return new Date(ver.updatedAt).toLocaleString("zh-CN");
}

function draft() {
  const result = store.saveDraft(selected.value.id, form.values, form.comment, form.conflict);
  if (result.ok) {
    if (result.failed) message.warning("草稿已保存，但合并失败；本地草稿已保留，可点“重试合并”");
    else message.success(store.online ? "评分草稿已保存并开始合并" : "断网：草稿已写入本机，回网后自动合并");
  } else message.error(result.error ?? "保存失败");
}
async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  const response = store.submit(selected.value.id, form.values, form.comment, form.conflict);
  if (response.ok) {
    if (response.failed) message.warning("评分已提交但合并失败；草稿已保留，可重试");
    else message.success("匿名评分已提交");
  } else message.error(response.error ?? "提交失败");
}
function retry() {
  store.retryFlush().then((result) => {
    if (result?.ok) message.success("已重新发起合并，本地草稿未丢失");
  });
}
function resolve(keep: "local" | "remote") {
  const result = store.resolveConflict(selected.value.id, keep);
  if (result?.ok) message.success(keep === "local" ? "已保留本机版，评分恢复计入" : "已采用台账版，评分恢复计入");
  else message.error(result?.error ?? "确认失败");
}
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon>主办方在结果锁定前不能查看任何评委的评分值，只能看到提交进度。</NAlert>
  <NAlert v-if="!store.online && !store.isOrganizer" type="warning" show-icon>当前处于断网状态：评分先写入本机草稿，恢复网络后自动与共享台账合并，不会丢失。</NAlert>
  <NAlert v-if="currentScore?.sync === 'failed'" type="error" show-icon class="sync-alert">
    上次合并失败，本地草稿已保留未丢失。<NButton text type="primary" @click="retry">点此重试合并</NButton>
  </NAlert>
  <NAlert v-if="currentScore?.sync === 'conflict' && currentScore.remote" type="error" show-icon class="sync-alert">
    本机与台账都修改了同一项，已保留两版等待确认；确认前该评分不计入有效评委数与名次。
    <div class="conflict-grid">
      <article class="conflict-card"><header><b>本机版</b><NTag size="small" type="warning">保留</NTag></header><p class="conflict-score">加权 {{ versionWeighted(currentScore) }}</p><p class="conflict-comment">{{ currentScore.comment || "（无意见）" }}</p><small>{{ versionTime(currentScore) }}</small><NButton size="small" type="primary" block @click="resolve('local')">保留本机版</NButton></article>
      <article class="conflict-card"><header><b>台账版（他方终端）</b><NTag size="small">台账</NTag></header><p class="conflict-score">加权 {{ versionWeighted(currentScore.remote) }}</p><p class="conflict-comment">{{ currentScore.remote.comment || "（无意见）" }}</p><small>{{ versionTime(currentScore.remote) }}</small><NButton size="small" block @click="resolve('remote')">采用台账版</NButton></article>
    </div>
  </NAlert>
  <div class="workspace">
    <NCard title="匿名方案" class="scheme-panel"><button v-for="item in store.schemes" :key="item.id" class="scheme" :class="{ active: selectedId === item.id }" @click="selectedId = item.id"><span>{{ item.code }}</span><b>{{ item.title }}</b><small>{{ item.publicNo }} · {{ item.status }}</small></button></NCard>
    <NCard class="score-panel">
      <template #header><div class="card-title"><div><small>{{ selected.code }} · {{ selected.publicNo }}</small><h2>{{ selected.title }}</h2></div><NTag v-if="syncTag" :type="syncTag.type">{{ syncTag.label }}</NTag></div></template>
      <p class="synopsis">{{ selected.synopsis }}</p>
      <div class="criteria">
        <article v-for="item in store.criteria" :key="item.id"><div><b>{{ item.name }}</b><span>权重 {{ item.weight }}%</span><p>{{ item.description }}</p></div><NRate v-model:value="form.values[item.id]" :count="5" :disabled="disabled" /><small>{{ form.values[item.id] }} / {{ item.max }}</small></article>
      </div>
      <div class="weighted"><span>加权得分</span><NProgress type="line" :percentage="weighted" :height="18" /><b>{{ weighted.toFixed(1) }}</b></div>
      <label class="conflict-switch"><NSwitch v-model:value="form.conflict" :disabled="disabled" /><span><b>声明利益冲突</b><small>声明后本评分不计入最终排名</small></span></label>
      <label class="field"><span>评审意见（评委间不可见）</span><NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" /><small>{{ errors.comment }}</small></label>
      <div class="actions">
        <NButton :disabled="disabled" @click="draft">{{ store.online ? "保存草稿并合并" : "保存到本机草稿" }}</NButton>
        <NButton type="primary" :disabled="disabled" @click="submit">提交本方案评分</NButton>
        <NButton v-if="currentScore?.submitted && !locked" quaternary @click="store.recalled(selected.id)">退回修改</NButton>
        <NButton v-if="currentScore?.sync === 'failed'" type="error" ghost @click="retry">重试合并</NButton>
      </div>
    </NCard>
  </div>
</template>
