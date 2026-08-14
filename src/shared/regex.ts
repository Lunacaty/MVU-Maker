// 正则匹配工具：按"替换目标"而非名称查找正则
import type { RegexScript } from './types'

export interface RegexTargetMatch {
  scriptName: string
  findRegex: string
  replaceString: string
  promptOnly: boolean
  markdownOnly: boolean
  id: string
  runOnEdit: boolean
}

export interface RegexTargetResult {
  /** 显示侧（markdownOnly 替换） */
  replace: RegexTargetMatch | null
  /** AI 隐藏侧（promptOnly 替换为空） */
  hide: RegexTargetMatch | null
}

/**
 * 在项目正则里按替换目标匹配：
 * findRegex 的源文本含 target（如 `<StatusPlaceHolderImpl/>`），或 target 含 findRegex 去斜杠后的纯文本。
 */
export function matchRegexByTarget(regexes: RegexScript[], target: string): RegexTargetResult {
  let replace: RegexTargetMatch | null = null
  let hide: RegexTargetMatch | null = null
  const targetTrim = target.trim()
  for (const r of regexes) {
    if (r.disabled) continue
    const find = r.findRegex ?? ''
    // 去掉 /flags 包裹
    const bare = find.replace(/^\/|\/[a-z]*$/g, '')
    const hit = bare.includes(targetTrim) || targetTrim.includes(bare)
    if (!hit) continue
    const m: RegexTargetMatch = {
      scriptName: r.scriptName,
      findRegex: r.findRegex,
      replaceString: r.replaceString,
      promptOnly: r.promptOnly,
      markdownOnly: r.markdownOnly,
      runOnEdit: r.runOnEdit,
      id: r.id
    }
    if (r.promptOnly && !r.markdownOnly) hide = hide ?? m
    else if (r.markdownOnly && !r.promptOnly) replace = replace ?? m
    else replace = replace ?? m
  }
  return { replace, hide }
}

/** 把替换侧 replaceString 中首尾三反引号去掉，得到纯 HTML */
export function extractHtmlFromReplace(replaceString: string): string {
  let s = replaceString
  s = s.replace(/^```[^\n]*\n/, '').replace(/```\s*$/, '')
  return s.trim()
}
