// initvar 校验：jiti 加载生成的 schema 代码（注入全局 z/_），Schema.parse(yaml)
import { createJiti } from 'jiti'
import { z } from 'zod'
import * as lodash from 'lodash'
import { parse as parseYaml } from 'yaml'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { InitvarValidationResult } from '../../shared/ipc'

// 注入全局（schema 代码里的 z / _ 是自由变量）
;(globalThis as Record<string, unknown>).z = z
;(globalThis as Record<string, unknown>)._ = lodash

/**
 * 校验 initvar YAML 是否通过 schema。
 * schemaCode 形如 "z.object({...})"（不含 export const Schema）。
 */
export async function validateInitvar(
  schemaCode: string,
  yamlText: string
): Promise<InitvarValidationResult> {
  try {
    const data = parseYaml(yamlText)
    const schema = await loadSchema(schemaCode)
    // zod v4 的 Schema.parse 会在失败时抛 ZodError
    try {
      schema.parse(data)
      return { ok: true, errors: [] }
    } catch (e) {
      const errors =
        (e as { issues?: { path: (string | number)[]; message: string }[] }).issues ?? []
      return { ok: false, errors: errors.map((x) => ({ path: x.path, message: x.message })) }
    }
  } catch (e) {
    return { ok: false, errors: [{ path: [], message: (e as Error).message }] }
  }
}

async function loadSchema(schemaCode: string): Promise<{ parse(data: unknown): unknown }> {
  const dir = await mkdtemp(join(tmpdir(), 'mvu-schema-'))
  try {
    // z/_ 已在 globalThis，schema 代码无 import，jiti 无需解析 bare 依赖
    const file = join(dir, 'schema.ts')
    await writeFile(file, `export const Schema = ${schemaCode}\n`, 'utf-8')
    const jiti = createJiti(file, { interopDefault: true })
    const mod = (await jiti.import(file, { default: undefined })) as {
      Schema: { parse(data: unknown): unknown }
    }
    return mod.Schema
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
