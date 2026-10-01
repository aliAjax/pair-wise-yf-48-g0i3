<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NRate, NSwitch, NTag, useMessage } from "naive-ui";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useReviewStore } from "../stores/review";
import ConflictList from "../components/ConflictList.vue";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });
const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const currentScore = computed(() => store.record(selected.value.id));
const locked = computed(() => selected.value.status === "已锁定");
const form = reactive({ values: Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>, comment: "", conflict: false });
const schema = toTypedSchema(z.object({ comment: z.string().min(4, "请至少填写4个字的评审意见") }));
const { errors, validate } = useForm({ validationSchema: schema });

function loadForm() {
  const record = store.record(selected.value.id);
  form.values = { ...(record?.values ?? Object.fromEntries(store.criteria.map((item) => [item.id, 60]))) };
  form.comment = record?.comment ?? "";
  form.conflict = record?.conflict ?? false;
}

watch(selectedId, loadForm, { immediate: true });
watch(() => currentScore.value?.conflictPending, (pending, previous) => {
  if (previous && !pending) loadForm();
});

const weighted = computed(() => store.criteria.reduce((sum, item) => sum + form.values[item.id] * item.weight / 100, 0));
const disabled = computed(() => store.isOrganizer || currentScore.value?.submitted || currentScore.value?.conflictPending || locked.value);

function dirtyOf(schemeId: string) {
  return store.scores.some((score) => score.schemeId === schemeId && score.judge === store.judge && score.dirty);
}

function draft() {
  store.saveDraft(selected.value.id, form.values, form.comment, form.conflict);
  message.success(store.online ? "评分草稿已保存并合并到台账" : "草稿已保存在本机，回网后自动合并");
}
async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  store.submit(selected.value.id, form.values, form.comment, form.conflict);
  message.success(store.online ? "匿名评分已提交并合并到台账" : "已提交到本机，回网后自动合并到台账");
}
function recall() {
  store.recalled(selected.value.id);
  message.info("已退回，可重新修改后再提交");
}
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon class="mb">主办方在结果锁定前不能查看任何评委的评分值。</NAlert>
  <NAlert v-else-if="!store.online" type="warning" show-icon class="mb">当前离线：打分与意见保存在本机，恢复网络后按方案自动合并到共享台账。</NAlert>
  <NAlert v-if="currentScore?.conflictPending" type="error" show-icon class="mb">该方案评分在本机与台账两边都改过，请先在下方“待确认冲突”中选择版本，确认前不计入排名。</NAlert>
  <div class="workspace">
    <NCard title="匿名方案" class="scheme-panel"><button v-for="item in store.schemes" :key="item.id" class="scheme" :class="{ active: selectedId === item.id }" @click="selectedId = item.id"><span>{{ item.code }}</span><b>{{ item.title }}</b><small>{{ item.publicNo }} · {{ item.status }}<template v-if="dirtyOf(item.id)"> · 待同步</template></small></button></NCard>
    <NCard class="score-panel">
      <template #header><div class="card-title"><div><small>{{ selected.code }} · {{ selected.publicNo }}</small><h2>{{ selected.title }}</h2></div><NTag :type="locked ? 'success' : 'warning'">{{ selected.status }}</NTag></div></template>
      <p class="synopsis">{{ selected.synopsis }}</p>
      <div class="criteria">
        <article v-for="item in store.criteria" :key="item.id"><div><b>{{ item.name }}</b><span>权重 {{ item.weight }}%</span><p>{{ item.description }}</p></div><NRate v-model:value="form.values[item.id]" :count="5" :disabled="disabled" /><small>{{ form.values[item.id] }} / {{ item.max }}</small></article>
      </div>
      <div class="weighted"><span>加权得分</span><NProgress type="line" :percentage="weighted" :height="18" /><b>{{ weighted.toFixed(1) }}</b></div>
      <label class="conflict-switch"><NSwitch v-model:value="form.conflict" :disabled="disabled" /><span><b>声明利益冲突</b><small>声明后本评分不计入最终排名</small></span></label>
      <label class="field"><span>评审意见（评委间不可见）</span><NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" /><small>{{ errors.comment }}</small></label>
      <div class="actions"><NButton :disabled="disabled" @click="draft">保存草稿</NButton><NButton type="primary" :disabled="disabled" @click="submit">提交本方案评分</NButton><NButton v-if="currentScore?.submitted && !locked" quaternary @click="recall">退回修改</NButton><NTag v-if="currentScore?.dirty" size="small" type="warning">待同步</NTag></div>
    </NCard>
  </div>
  <ConflictList />
</template>
