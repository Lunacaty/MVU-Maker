// MVU 注入常亮与模板：占位符 / 脚本 / 正则 / 世界书条目
import type { HelperScript, RegexScript, WorldInfoEntry } from './types'

export function uuid(): string {
  const rand = Math.random().toString(16).slice(2, 10)
  const time = Date.now().toString(16).slice(-6)
  return `id-${time}${rand}`
}

export const PLACEHOLDER_STATUS = '<StatusPlaceHolderImpl/>'
export const PLACEHOLDER_CREATE_CARD = '<CreateCardPlaceHolder/>'

export const MVU_SCRIPT_URL =
  'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'
export const MVU_ZOD_IMPORT_URL =
  'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js'

export function makeMvuScript(): HelperScript {
  return {
    type: 'script',
    enabled: true,
    id: uuid(),
    content: `import '${MVU_SCRIPT_URL}'`,
    info: '',
    button: { enabled: true, buttons: [{ name: '重新处理变量', visible: true }] },
    data: {}
  }
}

export function makeZodScript(schemaCode: string): HelperScript {
  return {
    type: 'script',
    enabled: true,
    id: uuid(),
    content: `import { registerMvuSchema } from '${MVU_ZOD_IMPORT_URL}';\n\nexport const Schema = ${schemaCode};\n\n$( () => { registerMvuSchema(Schema); });`,
    info: '',
    button: { enabled: true, buttons: [] },
    data: {}
  }
}

// ---------- 世界书条目 ----------
// MVU 官方标准配置（worldbook-skill/mvu-guide + StageDog tavern_helper_template）：
//   position 用 ST 的 atDepth(=4)，depth 与 order 见各条目注释；ST 读取时优先 entry.extensions.position。

export function makeInitVarEntry(yaml: string, maxId: number): WorldInfoEntry {
  return {
    keys: [],
    secondary_keys: [],
    comment: '[InitVar]请勿打开',
    content: yaml,
    constant: true,
    selective: false,
    insertion_order: 200,
    enabled: false, // 三铁律：必须禁用（MVU 只读禁用状态的 initvar 条目）
    position: '@D',
    extensions: { position: 4, depth: 4, role: 0, order: 200, display_index: 0 }, // atDepth depth=4
    id: maxId
  }
}

export function makeVariableListEntry(content: string, maxId: number): WorldInfoEntry {
  return {
    keys: [],
    secondary_keys: [],
    comment: '变量列表',
    content,
    constant: true,
    selective: false,
    insertion_order: 200,
    enabled: true,
    position: '@D',
    extensions: { position: 4, depth: 0, role: 0, order: 200, display_index: 0 }, // atDepth depth=0/1：必须贴近最新上下文
    id: maxId
  }
}

export function makeUpdateRulesEntry(content: string, maxId: number): WorldInfoEntry {
  return {
    keys: [],
    secondary_keys: [],
    comment: '[mvu_update]变量更新规则',
    content,
    constant: true,
    selective: false,
    insertion_order: 200,
    enabled: true,
    position: '@D',
    extensions: { position: 4, depth: 0, role: 0, order: 200, display_index: 0 }, // atDepth depth=0（或 after_char）
    id: maxId
  }
}

export function makeOutputFormatEntry(content: string, maxId: number): WorldInfoEntry {
  return {
    keys: [],
    secondary_keys: [],
    comment: '[mvu_update]变量输出格式',
    content,
    constant: true,
    selective: false,
    insertion_order: 200,
    enabled: true,
    position: '@D',
    extensions: { position: 4, depth: 4, role: 0, order: 200, display_index: 0 }, // atDepth depth=0(Gemini)/4(Claude)
    id: maxId
  }
}

// ---------- 正则 ----------

export function makeRegex(
  scriptName: string,
  findRegex: string,
  replaceString: string,
  opts: Partial<
    Pick<RegexScript, 'promptOnly' | 'markdownOnly' | 'runOnEdit' | 'placement' | 'disabled'>
  >
): RegexScript {
  return {
    id: uuid(),
    scriptName,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: opts.placement ?? [2],
    disabled: opts.disabled ?? false,
    markdownOnly: opts.markdownOnly ?? false,
    promptOnly: opts.promptOnly ?? false,
    runOnEdit: opts.runOnEdit ?? true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null
  }
}

export function makeStatusBarPair(html: string): RegexScript[] {
  const placeholder = PLACEHOLDER_STATUS
  return [
    makeRegex('对AI隐藏状态栏', placeholder, '', {
      promptOnly: true,
      markdownOnly: false,
      placement: [2]
    }),
    makeRegex('状态栏界面', placeholder, `\`\`\`\n${html}\n\`\`\``, {
      promptOnly: false,
      markdownOnly: true,
      placement: [2]
    })
  ]
}

export function makeCreateCardPair(html: string): RegexScript[] {
  const placeholder = PLACEHOLDER_CREATE_CARD
  return [
    makeRegex('对AI隐藏创建卡片', placeholder, '', {
      promptOnly: true,
      markdownOnly: false,
      placement: [2]
    }),
    makeRegex('角色创建卡片', placeholder, `\`\`\`\n${html}\n\`\`\``, {
      promptOnly: false,
      markdownOnly: true,
      placement: [2]
    })
  ]
}

// 变量更新美化：两条正则（更新中 / 更新完成），另加可选的对AI隐藏
// ⚠ 替换产物禁止 <style>/<script> 标签（沙盒 iframe 会剥离 head 样式），CSS 必须全部内联到 style 属性
export function makeVariableBeautifyRegexes(): RegexScript[] {
  return [
    makeRegex(
      '变量更新中美化',
      String.raw`/<(update(?:variable)?)>(?!.*<\/\1>)\s*((?:(?!<\1>).)*)\s*$/gsi`,
      '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body><div style="color:#f5a623;font-style:italic;padding:8px 12px;border-left:3px solid #f5a623;background:rgba(245,166,35,.10);border-radius:4px;font-size:13px;line-height:1.6">正在更新变量...</div></body></html>\n```',
      { promptOnly: false, markdownOnly: true, placement: [1, 2], runOnEdit: false }
    ),
    makeRegex(
      '变量更新美化',
      String.raw`/<(update(?:variable)?)>\s*((?:(?!<\1>).)*)\s*<\/\1>/gsi`,
      '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body><details open style="border:1px solid #f5a623;border-radius:8px;padding:10px 12px;margin:6px 0;background:#0d1320;color:#e8ecf3;font-size:13px"><summary style="color:#ffc94d;font-weight:bold;margin-bottom:6px;cursor:pointer;user-select:none">变量更新</summary><div style="white-space:pre-wrap;line-height:1.6">$2</div></details></body></html>\n```',
      { promptOnly: false, markdownOnly: true, placement: [1, 2], runOnEdit: false }
    )
  ]
}

export function makeHideVariableUpdateRegex(): RegexScript {
  return makeRegex(
    '对AI隐藏变量更新',
    String.raw`/<(update(?:variable)?)>(?:(?!.*<\/\1>)(?:(?!<\1>).)*$|(?:(?!<\1>).)*<\/\1?>)/gsi`,
    '',
    { promptOnly: true, markdownOnly: false, placement: [1, 2], runOnEdit: false }
  )
}

// ---------- 默认世界书模板 ----------

export function variableListTemplate(): string {
  return `---
<status_current_variable>
{{format_message_variable::stat_data}}
</status_current_variable>

## 数据权威声明

以下 stat_data 变量列表是角色当前状态的**唯一权威数据来源**。
- 所有数值（积分、好感度、HP、MP、数量等）一律以本列表为准
- 大总结、小总结、动向、小圈子等记忆内容中提到的旧数值仅供参考，可能已过时，**不得**用来覆盖本列表
- 更新变量时，必须基于本列表当前值计算增减，而不是基于记忆文本中的数值
- 若记忆与列表冲突，以本列表为准
`
}

export function updateRulesTemplate(): string {
  return `---
变量更新规则:
  主角:
    物品栏:
      type: |-
        {
          [物品名: string]: { 描述: string; 数量?: number; }
        }
      check:
        - 获取、消耗、丢弃物品时更新
        - 数量归零后自动消失
`
}

export function outputFormatTemplate(): string {
  return `---
<update_variable_rules>
rule:
  - you must output the update analysis and the actual update commands at once in the end of the next reply
  - 'the update commands must strictly follow the **JSON Patch (RFC 6902)** standard, but can only use the following operations: replace, add, remove; the output must be a valid JSON array containing operation objects'
format: |-
  <UpdateVariable>
  <Analysis>（中文，不超过600字）
    0. 时间:
       正文检查: 根据剧情进展判断时间是否推进,决定是否需要更新时间
       硬约束: 时间格式必须为 YYYY-MM-DD HH:mm;剧情无时间推进时不得更新
    1. 主角:
       正文检查: 检查正文中主角的名称、状态、所处地点等是否变化
       硬约束: 主角名称不得修改;各字段字数不得超过50字
    2. 出场角色:
       正文检查: 检查正文出场的NPC及其状态变化
       硬约束: 正文出场的NPC,心声字段必须更新
    3. 路径:
       正文检查: 检查本次需要更新的变量路径是否都在变量列表中
       硬约束: 路径必须为中文,严格遵守变量列表中的结构;不得擅自将路径翻译为英文
  </Analysis>
  <JSONPatch>
  [
    { "op": "replace", "path": "\${/path/to/variable}", "value": \${new_value} },
    { "op": "add", "path": "\${/path/to/object/newKey}", "value": \${content} },
    { "op": "remove", "path": "\${/path/to/array/0}" }
  ]
  </JSONPatch>
  </UpdateVariable>
</update_variable_rules>

虽然示例指令的路径有\${}包裹,但实际写时不要有\${}。
`
}
