import { ElectronAPI } from '@electron-toolkit/preload'
import type { CardToolApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    cardTool: CardToolApi
  }
}
