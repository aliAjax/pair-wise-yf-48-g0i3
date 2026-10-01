<script setup lang="ts">
import { computed } from "vue";
import { NButton, NSwitch, NTag } from "naive-ui";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const lastSync = computed(() => store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleTimeString("zh-CN", { hour12: false }) : "尚未同步");
</script>

<template>
  <div class="sync-panel">
    <div class="sync-head"><small>共享评审台账</small><NTag size="small" :type="store.online ? 'success' : 'error'">{{ store.online ? "在线" : "离线" }}</NTag></div>
    <label class="sync-row"><span>网络连接</span><NSwitch :value="store.online" size="small" @update:value="(value: boolean) => store.setOnline(value)" /></label>
    <label class="sync-row"><span>弱网模拟</span><NSwitch v-model:value="store.flaky" size="small" /></label>
    <div class="sync-meta"><span>待同步 {{ store.pendingCount }} 条</span><span>{{ lastSync }}</span></div>
    <p v-if="store.lastError" class="sync-error">{{ store.lastError }}</p>
    <NButton size="small" secondary block :loading="store.syncing" :disabled="!store.online" @click="store.syncNow()">{{ store.lastError ? "重试合并" : "立即同步" }}</NButton>
  </div>
</template>
