import { defineStore } from 'pinia'
import { ref } from 'vue'

export type NavView =
  | 'overview'
  | 'openings'
  | 'worldbook'
  | 'regex'
  | 'scripts'
  | 'schema'
  | 'statusbar'
  | 'createcard'
  | 'beautify'
  | 'updaterules'
  | 'ai'
  | 'llmprompts'
  | 'export'

export const useNavStore = defineStore('nav', () => {
  const view = ref<NavView>('overview')
  function go(v: NavView): void {
    view.value = v
  }
  return { view, go }
})
