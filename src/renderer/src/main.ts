import './assets/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

const app = createApp(App)

// 全局渲染错误捕获（写入控制台，便于定位）
app.config.errorHandler = (err, _instance, info) => {
  console.error('[vue-error]', info, err)
}

app.use(createPinia()).mount('#app')

// 全局 unhandledrejection 捕获
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason)
})
