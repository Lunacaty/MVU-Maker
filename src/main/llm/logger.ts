// LLM 请求日志：完整记录每次请求/响应/错误，JSONL 追加写入 userData/logs/llm.log
import { app } from 'electron'
import { join } from 'path'
import { appendFile, mkdir, stat, rename } from 'fs/promises'

const MAX_BYTES = 10 * 1024 * 1024

let cachedPath: string | null = null

export function llmLogPath(): string {
  if (!cachedPath) {
    cachedPath = join(app.getPath('userData'), 'logs', 'llm.log')
  }
  return cachedPath
}

/** 追加一条 JSON 日志；文件超过上限时轮转为 .old */
export async function logLlm(entry: Record<string, unknown>): Promise<void> {
  try {
    const p = llmLogPath()
    try {
      const st = await stat(p)
      if (st.size > MAX_BYTES) {
        await rename(p, `${p}.old`)
      }
    } catch {
      // 文件不存在，忽略
    }
    await mkdir(join(p, '..'), { recursive: true })
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`
    await appendFile(p, line, 'utf-8')
  } catch (e) {
    console.error('[llm-log] 写入失败', e)
  }
}
