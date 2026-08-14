import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { CardToolApi, LlmChatRequest, LlmChatResult, MvuWorldbookDrafts } from '../shared/ipc'
import type {
  CardFormat,
  CardProject,
  SchemaCanvas,
  ToolConfig,
  ValidationReport
} from '../shared/types'

const api: CardToolApi = {
  openCard: () => ipcRenderer.invoke('card:open'),
  loadProject: () => ipcRenderer.invoke('project:get'),
  saveSessionProject: (project: CardProject) => ipcRenderer.invoke('project:saveSession', project),
  loadSessionProject: () => ipcRenderer.invoke('project:loadSession'),
  reconstructSchema: () => ipcRenderer.invoke('schema:reconstruct'),
  schemaToCode: (canvas: SchemaCanvas): Promise<string> =>
    ipcRenderer.invoke('schema:code', canvas),
  validateInitvar: (schemaCode, yaml) => ipcRenderer.invoke('initvar:validate', schemaCode, yaml),
  generateInitvarSkeleton: (schemaCode) => ipcRenderer.invoke('initvar:skeleton', schemaCode),
  testRegex: (findRegex, text) => ipcRenderer.invoke('regex:test', findRegex, text),
  testRegexReplace: (findRegex, replaceString, text) =>
    ipcRenderer.invoke('regex:testReplace', findRegex, replaceString, text),
  validateCard: (project: CardProject): Promise<ValidationReport> =>
    ipcRenderer.invoke('card:validate', project),
  exportCard: (project: CardProject, format: CardFormat) =>
    ipcRenderer.invoke('card:export', project, format),
  exportCardWithDrafts: (project: CardProject, format: CardFormat, drafts?: MvuWorldbookDrafts) =>
    ipcRenderer.invoke('card:export', project, format, drafts),
  getBeautifyTemplates: () => ipcRenderer.invoke('regex:beautifyTemplates'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: ToolConfig) => ipcRenderer.invoke('config:save', config),
  llmChat: (req: LlmChatRequest, systemPrompt: string): Promise<LlmChatResult> =>
    ipcRenderer.invoke('llm:chat', req, systemPrompt),
  llmStream: async (req, systemPrompt, onChunk): Promise<LlmChatResult> => {
    const handler = (_e: unknown, delta: string): void => onChunk(delta)
    ipcRenderer.on('llm:chunk', handler)
    try {
      return await ipcRenderer.invoke('llm:stream', req, systemPrompt)
    } finally {
      ipcRenderer.removeListener('llm:chunk', handler)
    }
  },
  openLlmLog: () => ipcRenderer.invoke('llm:openLog')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('cardTool', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.cardTool = api
}
