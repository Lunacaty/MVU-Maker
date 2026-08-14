<script setup lang="ts">
import { useProjectStore } from '../stores/project'
</script>

<template>
  <div class="no-card">
    <p>尚未打开角色卡</p>
    <button class="btn-primary" @click="useProjectStore().openCard()">导入角色卡</button>
  </div>
</template>

<style scoped>
.no-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 80px 0;
  color: #a9b3c3;
}
.btn-primary {
  background: linear-gradient(135deg, #f5a623, #d98d1f);
  color: #0d1320;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}
</style>
