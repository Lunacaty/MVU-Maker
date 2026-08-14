// M3 · PatchEngine：幂等改卡管线
import type {
  CharCardV2,
  HelperScript,
  Opening,
  RegexScript,
  WorldInfoEntry
} from '../../shared/types'
import {
  PLACEHOLDER_CREATE_CARD,
  PLACEHOLDER_STATUS,
  makeCreateCardPair,
  makeInitVarEntry,
  makeMvuScript,
  makeOutputFormatEntry,
  makeStatusBarPair,
  makeUpdateRulesEntry,
  makeVariableListEntry,
  makeZodScript
} from '../../shared/templates'

export interface PatchContext {
  openings: Opening[]
  initvarYaml: string
  schemaCode: string
  statusBarHtml?: string
  createCardHtml?: string
  updateRulesYaml: string
  outputFormatYaml: string
  variableListContent: string
}

function ensureExtensions(json: CharCardV2): void {
  if (!json.data.extensions) json.data.extensions = {}
  if (!json.data.extensions.regex_scripts) json.data.extensions.regex_scripts = []
  if (!json.data.extensions.tavern_helper)
    json.data.extensions.tavern_helper = { scripts: [], variables: {} }
}

function ensureCharacterBook(json: CharCardV2): void {
  if (!json.data.character_book)
    json.data.character_book = { name: `${json.data.name} 世界书`, entries: [] }
  if (!Array.isArray(json.data.character_book.entries)) {
    // 源卡若存的是对象（非 spec），归一化为数组再处理，保证导出 ST 可读
    json.data.character_book.entries = Object.values(json.data.character_book.entries)
  }
}

function maxEntryId(json: CharCardV2): number {
  const entries = json.data.character_book?.entries ?? []
  const ids = Object.values(entries).map((e) => Number(e.id) || 0)
  return ids.length ? Math.max(...ids) + 1 : 0
}

export class PatchEngine {
  constructor(private ctx: PatchContext) {}

  /** 加 MVU：脚本 + 四个世界书条目 + 状态栏占位符 */
  applyMvu(json: CharCardV2): { changed: boolean[] } {
    ensureExtensions(json)
    ensureCharacterBook(json)
    const scripts = json.data.extensions!.tavern_helper!.scripts!
    const changes: boolean[] = []

    // 1. MVU 脚本（幂等：已有则跳过；key/内容大小写不敏感，避免新建重复脚本）
    const mvuKey = Object.keys(scripts).find(
      (k) => k.toLowerCase() === 'mvu' || (scripts[k]?.content ?? '').includes('MagVarUpdate')
    )
    if (!mvuKey) {
      scripts['MVU'] = makeMvuScript()
      changes.push(true)
    } else changes.push(false)

    // 2. Zod 脚本：以当前画布 schema 为准，导出时**总是**用最新 schemaCode 重写
    //    （画布是工具的数据源；key/内容大小写不敏感匹配，如卡里是 'ZOD' 也直接更新，避免旧 schema 残留）
    const zodKey = Object.keys(scripts).find(
      (k) =>
        k.toLowerCase() === 'zod' ||
        /registerMvuSchema|export\s+const\s+Schema/.test(scripts[k]?.content ?? '')
    )
    if (zodKey) {
      scripts[zodKey] = makeZodScript(this.ctx.schemaCode)
      changes.push(true)
    } else {
      scripts['Zod'] = makeZodScript(this.ctx.schemaCode)
      changes.push(true)
    }

    // 3. 四个世界书条目（幂等：按 comment 判重）
    const entries = json.data.character_book!.entries
    const entrySpecs: { comment: string; make: (maxId: number) => WorldInfoEntry }[] = [
      { comment: '[InitVar]请勿打开', make: (id) => makeInitVarEntry(this.ctx.initvarYaml, id) },
      {
        comment: '变量列表',
        make: (id) => makeVariableListEntry(this.ctx.variableListContent, id)
      },
      {
        comment: '[mvu_update]变量更新规则',
        make: (id) => makeUpdateRulesEntry(this.ctx.updateRulesYaml, id)
      },
      {
        comment: '[mvu_update]变量输出格式',
        make: (id) => makeOutputFormatEntry(this.ctx.outputFormatYaml, id)
      }
    ]
    for (const spec of entrySpecs) {
      // 前缀/条目名匹配不分大小写（如卡内写的是 [initvar]/[MVU_UPDATE]）
      const lower = spec.comment.toLowerCase()
      const existing = Object.values(entries).find((e) => e.comment.toLowerCase() === lower)
      if (!existing) {
        const maxId = maxEntryId(json)
        const entry = spec.make(maxId)
        entries.push(entry)
        changes.push(true)
      } else changes.push(false)
    }

    // 4. 状态栏占位符（幂等：已含则跳过）
    const hasPlaceholder = json.data.first_mes.includes(PLACEHOLDER_STATUS)
    if (!hasPlaceholder) {
      json.data.first_mes = json.data.first_mes.trimEnd() + `\n\n${PLACEHOLDER_STATUS}`
      changes.push(true)
    } else changes.push(false)

    return { changed: changes }
  }

  /** 加状态栏：两条正则 */
  applyStatusBar(json: CharCardV2): boolean {
    ensureExtensions(json)
    if (!this.ctx.statusBarHtml) return false
    const regexes = json.data.extensions!.regex_scripts!
    if (regexes.some((r) => r.scriptName === '状态栏界面')) return false
    regexes.push(...makeStatusBarPair(this.ctx.statusBarHtml))
    return true
  }

  /** 加角色创建卡片：占位符 + 两条正则 */
  applyCreateCard(json: CharCardV2): boolean {
    ensureExtensions(json)
    if (!this.ctx.createCardHtml) return false
    const regexes = json.data.extensions!.regex_scripts!
    if (regexes.some((r) => r.scriptName === '角色创建卡片')) return false
    // 混合/创建卡片开场白追加占位符（幂等）
    for (const opening of this.ctx.openings) {
      if (opening.type === 'createCard' || opening.type === 'mixed') {
        if (!opening.text.includes(PLACEHOLDER_CREATE_CARD)) {
          opening.text = opening.text.trimEnd() + `\n\n${PLACEHOLDER_CREATE_CARD}`
        }
      }
    }
    regexes.push(...makeCreateCardPair(this.ctx.createCardHtml))
    return true
  }

  /** 开场白 initvar override 嵌入（幂等：已存在则替换） */
  applyOpeningInitvar(): void {
    const wrap = (yaml: string): string =>
      `---\n<UpdateVariable>\n<initvar>\n${yaml}\n</initvar>\n</UpdateVariable>`
    const regex = /---\n<UpdateVariable>\n<initvar>\n[\s\S]*?\n<\/initvar>\n<\/UpdateVariable>/g
    for (const opening of this.ctx.openings) {
      if (!opening.initvarOverride?.trim()) continue
      const block = wrap(opening.initvarOverride.trim())
      if (opening.text.match(regex)) {
        opening.text = opening.text.replace(regex, block)
      } else {
        opening.text = opening.text.trimEnd() + `\n\n${block}`
      }
    }
  }

  /** 世界书条目全量替换（由管理面板生成）；entries 写为数组，符合 chara_card_v2 spec */
  applyWorldbookEntries(json: CharCardV2, entries: WorldInfoEntry[]): void {
    ensureCharacterBook(json)
    json.data.character_book!.entries = entries ?? []
    // 旧模板注入的 MVU 条目 position 可能是错的（EMBottom=6），导出前按官方标准规范化
    this.applyMvuEntryPositions(json)
  }

  /**
   * 规范化 MVU 特征条目的位置（只改位置，不新增/删除/改内容——内容仍由用户手动管理）。
   * 官方标准（worldbook-skill/mvu-guide）：ST atDepth=4 + depth + order=200。
   * 旧模板曾写成 position=6(EMBottom)，ST 导入后位置完全错乱。
   */
  applyMvuEntryPositions(json: CharCardV2): void {
    const entries = json.data.character_book?.entries
    if (!entries) return
    for (const e of entries) {
      const c = e.comment
      if (c === '变量列表') {
        e.insertion_order = 200
        e.extensions = { ...e.extensions, position: 4, depth: 0, order: 200 }
      } else if (c.startsWith('[mvu_update]变量更新规则')) {
        e.insertion_order = 200
        e.extensions = { ...e.extensions, position: 4, depth: 0, order: 200 }
      } else if (c.startsWith('[mvu_update]变量输出格式')) {
        e.insertion_order = 200
        e.extensions = { ...e.extensions, position: 4, depth: 4, order: 200 }
      } else if (/^\[[Ii]nitvar\]/.test(c)) {
        e.insertion_order = 200
        e.extensions = { ...e.extensions, position: 4, depth: 4, order: 200 }
      }
    }
  }

  /**
   * 强制写回 MVU 三份世界书条目内容（幂等按 comment 定位，缺失则新建）：
   * 更新规则 / 输出格式来自「MVU世界书」页草稿；变量列表恒用程序默认值覆盖角色卡对应条目。
   */
  applyMvuEntryContents(
    json: CharCardV2,
    contents: { updateRules?: string; outputFormat?: string; variableList?: string }
  ): void {
    ensureCharacterBook(json)
    const entries = json.data.character_book!.entries
    const upsert = (comment: string, content: string): void => {
      if (!content) return
      const lower = comment.toLowerCase()
      const existing = Object.values(entries).find((e) => e.comment.toLowerCase() === lower)
      if (existing) existing.content = content
      else {
        const maxId = maxEntryId(json)
        const entry: WorldInfoEntry = {
          keys: [],
          secondary_keys: [],
          comment,
          content,
          constant: true,
          selective: false,
          insertion_order: 200,
          enabled: true,
          position: '@D',
          extensions: { position: 4, depth: 0, role: 0, order: 200, display_index: 0 },
          id: maxId
        }
        entries.push(entry)
      }
    }
    upsert('[mvu_update]变量更新规则', contents.updateRules ?? '')
    upsert('[mvu_update]变量输出格式', contents.outputFormat ?? '')
    upsert('变量列表', contents.variableList ?? '')
  }

  /** 正则全量替换（含顺序） */
  applyRegexes(json: CharCardV2, regexes: RegexScript[]): void {
    ensureExtensions(json)
    json.data.extensions!.regex_scripts = regexes
  }

  /**
   * 脚本全量替换。
   * 酒馆助手(JS-Slash-Runner)新版要求 tavern_helper.scripts 为**数组**（元素含 type/enabled/name/id/
   * content/info/button/data/export_with），Record 会被其 Zod 校验静默丢弃（catch 成空数组）导致"没有脚本"。
   */
  applyScripts(json: CharCardV2, scripts: Record<string, HelperScript>): void {
    ensureExtensions(json)
    const arr = Object.entries(scripts).map(([name, s]) => ({
      type: 'script' as const,
      enabled: s.enabled !== false,
      name,
      id: s.id,
      content: s.content,
      info: s.info ?? '',
      button: { enabled: true, buttons: s.button?.buttons ?? [] },
      data: s.data ?? {},
      export_with: { data: true, button: true }
    }))
    json.data.extensions!.tavern_helper!.scripts = arr
  }

  /** 开场白全量写回（main 开场白 + alternate_greetings） */
  applyOpenings(json: CharCardV2): void {
    for (const opening of this.ctx.openings) {
      if (opening.key === 'main') json.data.first_mes = opening.text
      else {
        const idx = Number(opening.key.replace('alt-', ''))
        if (!json.data.alternate_greetings) json.data.alternate_greetings = []
        json.data.alternate_greetings[idx] = opening.text
      }
    }
  }
}
