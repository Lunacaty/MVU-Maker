// IPC 处理器注册：Main 侧全部服务
import { app, dialog, ipcMain, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { mkdir, writeFile, readFile, stat } from 'fs/promises'
import { readCard, detectMvu } from './card/reader'
import { buildProject, extractZodSchemaCode } from './project'
import { validateInitvar } from './card/initvar'
import { Validator, compileRegex } from './validator'
import { exportCard } from './png/packer'
import { extractCharaJson, stExtractCharaText } from './png/chunks'
import { getConfig, saveConfig } from './configStore'
import { LlmGateway } from './llm/gateway'
import { llmLogPath } from './llm/logger'
import {
  canvasToZodCode,
  canvasToInitvarYaml,
  canvasToInitvarData,
  createEmptyCanvas
} from '../shared/schema'
import { makeVariableBeautifyRegexes } from '../shared/templates'
import { PatchEngine } from './patch/engine'
import type { CardFormat, CardProject, CharCardV2, ToolConfig } from '../shared/types'
import type { InitvarValidationResult, LlmChatRequest, SchemaReconstruction } from '../shared/ipc'
import { stringify as stringifyYaml } from 'yaml'

/**
 * 用 PatchEngine 把项目工作数据合成为最终卡 JSON。
 * **只写工作副本里已有的内容**（开场白 / 世界书 / 正则 / 脚本——这些由用户手动按钮注入/编辑产生），
 * **绝不自动添加** MVU/Zod 脚本、MVU 世界书条目或占位符（用户要求全手动）。
 */
function buildCardJson(project: CardProject): CharCardV2 {
  // 深拷贝原卡，避免污染
  const json: CharCardV2 = JSON.parse(JSON.stringify(project.card.json))
  const engine = new PatchEngine({
    openings: project.openings,
    initvarYaml: canvasToInitvarYaml(project.schemaCanvas),
    schemaCode: canvasToZodCode(project.schemaCanvas),
    updateRulesYaml: '',
    outputFormatYaml: '',
    variableListContent: ''
  })

  // 应用开场白 initvar override（先于 applyOpenings，因为嵌入在文本里）
  engine.applyOpeningInitvar()
  // 应用开场白文本
  engine.applyOpenings(json)
  // 应用管理面板的工作副本（用户通过「注入」按钮加入的状态栏/创建卡片/美化正则等）
  engine.applyWorldbookEntries(json, project.worldbookEntries)
  engine.applyRegexes(json, project.regexes)
  engine.applyScripts(json, project.scripts)
  // 不再调用 applyMvu / applyMvuEntryContents：MVU 脚本与世界书条目只由用户手动注入
  return json
}

export function registerIpc(
  getProject: () => CardProject | null,
  setProject: (p: CardProject) => void
): void {
  const gateway = new LlmGateway(async () => {
    return await getConfig()
  })

  // ---------- 开卡 ----------
  ipcMain.handle('card:open', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: '打开角色卡',
      filters: [
        { name: '角色卡 (PNG/JSON)', extensions: ['png', 'json'] },
        { name: '全部文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    const result = await readCard(path)
    const project = await buildProject(result)
    project.mvuDetected = detectMvu(result.json)
    setProject(project)
    const cfg = await getConfig()
    cfg.cardPath = path
    await saveConfig(cfg)
    return {
      path: result.path,
      format: result.format,
      json: result.json,
      project
    }
  })

  // ---------- 取项目 ----------
  ipcMain.handle('project:get', () => getProject())

  // ---------- 会话持久化：工作项目自动落盘，重启后恢复 ----------
  ipcMain.handle('project:saveSession', async (_e, project: CardProject) => {
    try {
      const dir = join(app.getPath('userData'))
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'session-project.json'), JSON.stringify(project), 'utf-8')
    } catch (e) {
      console.error('[session] 保存失败', e)
    }
  })
  ipcMain.handle('project:loadSession', async (): Promise<CardProject | null> => {
    try {
      const p = join(app.getPath('userData'), 'session-project.json')
      const raw = await readFile(p, 'utf-8')
      const parsed = JSON.parse(raw) as CardProject
      if (!parsed?.card?.path || !parsed?.schemaCanvas || !Array.isArray(parsed?.regexes))
        return null
      // 源卡文件已不存在 → 会话失效
      try {
        await stat(parsed.card.path)
      } catch {
        return null
      }
      return parsed
    } catch {
      return null
    }
  })

  // ---------- schema 反推 ----------
  ipcMain.handle('schema:reconstruct', async (): Promise<SchemaReconstruction> => {
    const project = getProject()
    if (!project) return { canvas: createEmptyCanvas(), schemaCode: '' }
    const code = extractZodSchemaCode(project.scripts)
    return { canvas: project.schemaCanvas, schemaCode: code }
  })

  ipcMain.handle('schema:code', (_e, canvas: CardProject['schemaCanvas']): string => {
    return canvasToZodCode(canvas)
  })

  // ---------- initvar 校验 ----------
  ipcMain.handle(
    'initvar:validate',
    async (_e, schemaCode: string, yaml: string): Promise<InitvarValidationResult> => {
      return validateInitvar(schemaCode, yaml)
    }
  )

  ipcMain.handle('initvar:skeleton', async (): Promise<string> => {
    const project = getProject()
    if (!project) return ''
    const data = canvasToInitvarData(project.schemaCanvas)
    return data ? stringifyYaml(data) : ''
  })

  // ---------- 正则测试 ----------
  ipcMain.handle('regex:test', (_e, findRegex: string, text: string) => {
    const c = compileRegex(findRegex)
    if (!c.ok) return { ok: false, error: c.error }
    try {
      const re = toRegExp(findRegex)
      const m = text.match(re)
      return { ok: true, output: m ? m[0] : '(无匹配)' }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'regex:testReplace',
    (_e, findRegex: string, replaceString: string, text: string) => {
      const c = compileRegex(findRegex)
      if (!c.ok) return { ok: false, error: c.error }
      try {
        const re = toRegExp(findRegex)
        return { ok: true, output: text.replace(re, replaceString) }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  // ---------- 校验 / 导出 ----------
  ipcMain.handle('card:validate', (_e, project: CardProject) => {
    const built = buildCardJson(project)
    const v = new Validator({ ...project, card: { ...project.card, json: built } })
    return v.run()
  })

  ipcMain.handle('card:export', async (_e, project: CardProject, format: CardFormat) => {
    console.log('[export] 收到项目', {
      card: project?.card?.path,
      openings: project?.openings?.length ?? 0,
      regexes: project?.regexes?.length ?? 0,
      scripts: Object.keys(project?.scripts ?? {}),
      worldbookEntries: project?.worldbookEntries?.length ?? 0
    })
    let built: CharCardV2
    try {
      built = buildCardJson(project)
    } catch (e) {
      console.error('[export] buildCardJson 失败', e)
      return {
        path: '',
        format,
        report: {
          ok: false,
          checks: [{ name: '导出构建失败', passed: false, message: (e as Error).message }]
        }
      }
    }
    console.log('[export] 构建完成', {
      regexes: built.data.extensions?.regex_scripts?.length ?? 0,
      scripts: Array.isArray(built.data.extensions?.tavern_helper?.scripts)
        ? built.data.extensions.tavern_helper.scripts.map((s) => s.name ?? '')
        : Object.keys(built.data.extensions?.tavern_helper?.scripts ?? {}),
      worldbookEntries: built.data.character_book?.entries?.length ?? 0,
      firstMesHead: built.data.first_mes?.slice(0, 40)
    })
    const v = new Validator({ ...project, card: { ...project.card, json: built } })
    const report = v.run()
    // 校验仅作报告参考，不再阻止导出：即使未通过也导出角色卡
    console.log('[export] 校验', {
      ok: report.ok,
      failed: report.checks.filter((c) => !c.passed).length
    })

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const ext = format === 'png' ? 'png' : 'json'
    // 默认文件名带时间戳：绝不覆盖源卡（曾因默认同名导出覆盖源卡导致源卡被旧构建污染）
    const base = project.card.path.replace(/\.[^.]+$/, '')
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const res = await dialog.showSaveDialog(win, {
      title: '导出角色卡',
      defaultPath: `${base}-${stamp}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    if (res.canceled || !res.filePath) return { path: '', format, report }

    // PNG 输出需原头像：从源文件重读 buffer（chunk 处理，毫秒级）
    const { readFile } = await import('fs/promises')
    const sourceBuffer = format === 'png' ? await readFile(project.card.path) : undefined
    await exportCard(built, format, res.filePath, sourceBuffer)
    // 写回自检：PNG 立即重读，用 SillyTavern character-card-parser 同款逻辑（tEXt 收集 → 优先 ccv3 其次 chara → base64 解码 → JSON.parse）
    if (format === 'png') {
      try {
        const written = await readFile(res.filePath)
        const stText = stExtractCharaText(written)
        let stOk = false
        let stName: string | null = null
        if (stText) {
          try {
            stName = (JSON.parse(stText) as { name?: string })?.name ?? null
            stOk = true
          } catch {
            stOk = false
          }
        }
        const marker = built.data.name ?? '(无名字)'
        console.log('[export] 写回自检', {
          stOk,
          stName,
          marker,
          myOk: extractCharaJson(written)?.includes(marker) ?? false
        })
        if (!stOk) {
          console.error('[export] ⚠ SillyTavern 解析该导出文件会失败，请勿导入！')
        }
      } catch (e) {
        console.error('[export] 写回自检失败', e)
      }
    }
    return { path: res.filePath, format, report }
  })

  // ---------- 美化正则模板 ----------
  ipcMain.handle('regex:beautifyTemplates', () => makeVariableBeautifyRegexes())

  // ---------- 配置 ----------
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:save', (_e, config: ToolConfig) => saveConfig(config))

  // ---------- LLM ----------
  ipcMain.handle('llm:chat', (_e, req: LlmChatRequest, systemPrompt: string) =>
    gateway.chat(req, systemPrompt)
  )
  ipcMain.handle('llm:stream', async (event, req: LlmChatRequest, systemPrompt: string) => {
    return gateway.chatStream(req, systemPrompt, (delta) => {
      event.sender.send('llm:chunk', delta)
    })
  })
  // 用系统默认应用打开 LLM 日志文件
  ipcMain.handle('llm:openLog', async () => {
    const p = llmLogPath()
    await shell.openPath(p)
    return p
  })
}

function toRegExp(findRegex: string): RegExp {
  let source = findRegex
  let flags = ''
  if (source.startsWith('/')) {
    const lastSlash = source.lastIndexOf('/')
    if (lastSlash > 0) {
      flags = source.slice(lastSlash + 1)
      source = source.slice(1, lastSlash)
    }
  }
  return new RegExp(source, flags)
}
