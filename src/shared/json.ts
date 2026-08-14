// LLM 结构化输出解析：从 AI 原始文本中稳健提取 JSON 数组
// 背景：LLM 输出常带 markdown 代码块围栏（```json … ```）、前后解释文字，
// 或在 JSON 字符串里写无效转义（\s、\1 等单反斜杠），直接 JSON.parse 必然失败。

export interface JsonArrayResult {
  ok: boolean
  value?: unknown[]
  error?: string
}

/** 剥掉首尾 ``` 代码块围栏（```json / ``` 均可） */
export function stripMarkdownFence(text: string): string {
  return text
    .replace(/^\s*```[^\n]*\n?/, '')
    .replace(/```\s*$/, '')
    .trim()
}

/**
 * 修复 JSON 字符串中的无效反斜杠转义：`\s`、`\1`、`\.`、`\(` 等 → `\\s`、`\\1`…
 * 只处理"前面不是反斜杠"的 `\`，避免破坏已合法的 `\\`（如 JSON 中的 `\\s`）。
 * 合法转义集合：\" \\ \/ \b \f \n \r \t \u。
 */
export function fixJsonEscapes(text: string): string {
  // 匹配"前面不是反斜杠"的单个 `\` 且后跟非合法转义字符，双写为 `\\`
  return text.replace(/(^|[^\\])\\(?!["\\/bfnrtu])/g, '$1\\\\')
}

/**
 * 提取文本中第一个平衡的 `[...]` 数组子串（支持嵌套数组与字符串内的 `[`/`]`）。
 * 找不到返回 null。
 */
export function extractFirstArray(text: string): string | null {
  const start = text.indexOf('[')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 从 AI 输出中稳健提取 JSON 数组。尝试顺序：
 *   1. 原文直接解析（剥代码块围栏后）
 *   2. 修复无效转义后解析
 *   3. 提取平衡 `[...]` 子串后解析（兼容前后解释文字）
 *   4. 子串修复转义后解析
 */
export function extractJsonArray(text: string): JsonArrayResult {
  const candidates: string[] = [stripMarkdownFence(text)]
  const arr = extractFirstArray(text)
  if (arr) candidates.push(arr)
  for (const candidate of candidates) {
    for (const attempt of [candidate, fixJsonEscapes(candidate)]) {
      try {
        const value = JSON.parse(attempt) as unknown
        if (Array.isArray(value)) return { ok: true, value }
      } catch {
        // 继续尝试下一个
      }
    }
  }
  return { ok: false, error: '未在 AI 输出中找到可解析的 JSON 数组' }
}
