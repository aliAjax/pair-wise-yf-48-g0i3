<script setup lang="ts">
import { NSwitch, NButton, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";
const store = useReviewStore();
const message = useMessage();
const pendingCount = () => store.scores.filter((item) => item.dirty && item.sync !== "synced").length;
function toggleOnline(value: boolean) {
  store.setOnline(value);
  message.info(value ? "已恢复联网，开始按方案合并" : "已断网：评分只写本机草稿");
}
function armFailure(value: boolean) {
  store.armFailure = value;
  if (value) message.warning("已武装：下一次合并将失败，本地草稿保留");
}
function retry() {
  store.retryFlush().then((result) => {
    if (result?.ok) message.success("已重试合并，本地草稿未丢失");
  });
}
</script>
<template>
  <div class="net-panel">
    <div class="net-row"><span>共享台账网络</span><NTag size="small" :type="store.online ? 'success' : 'warning'">{{ store.online ? "在线" : "断网" }}</NTag></div>
    <NSwitch :value="store.online" @update:value="toggleOnline" size="small" />
    <label class="net-check"><input type="checkbox" :checked="store.armFailure" @change="(event) => armFailure((event.target as HTMLInputElement).checked)" />模拟下次合并失败</label>
    <NButton size="small" block quaternary @click="retry" :disabled="store.syncing">重试合并（{{ pendingCount() }} 项待同步）</NButton>
  </div>
</template>
