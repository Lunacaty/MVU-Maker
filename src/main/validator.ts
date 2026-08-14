// M7 · Validator：导出前全部校验
import type { CardProject, CheckResult, ValidationReport } from '../shared/types'
import { PLACEHOLDER_CREATE_CARD, PLACEHOLDER_STATUS } from '../shared/templates'

function compileRegex(findRegex: string): { ok: boolean; error?: string } {
  let source = findRegex
  let flags = ''
  if (source.startsWith('/')) {
    const lastSlash = source.lastIndexOf('/')
    if (lastSlash > 0) {
      flags = source.slice(lastSlash + 1)
      source = source.slice(1, lastSlash)
    }
  }
  try {
    new RegExp(source, flags)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export class Validator {
  constructor(private project: CardProject) {}

  checkStructure(): CheckResult {
    const { json } = this.project.card
    try {
      const roundtrip = JSON.parse(JSON.stringify(json))
      if (JSON.stringify(roundtrip) !== JSON.stringify(json)) {
        return { name: '结构合法', passed: false, message: 'JSON 序列化往返不一致' }
      }
    } catch {
      return { name: '结构合法', passed: false, message: 'JSON 序列化失败' }
    }
    return { name: '结构合法', passed: true }
  }

  checkRequiredFields(): CheckResult {
    const { json } = this.project.card
    const missing: string[] = []
    if (!json.data.name) missing.push('data.name')
    if (!json.data.first_mes) missing.push('data.first_mes')
    return {
      name: 'spec/必填字段',
      passed: missing.length === 0,
      message: missing.length ? `缺少: ${missing.join(', ')}` : undefined
    }
  }

  checkRegexes(): CheckResult[] {
    const results: CheckResult[] = []
    const regexes = this.project.regexes
    for (const r of regexes) {
      if (r.disabled) continue
      const c = compileRegex(r.findRegex)
      if (!c.ok) {
        results.push({
          name: `正则可编译·${r.scriptName}`,
          passed: false,
          message: c.error
        })
      } else {
        results.push({ name: `正则可编译·${r.scriptName}`, passed: true })
      }
    }
    return results
  }

  checkRegexPairs(): CheckResult[] {
    const json = this.project.card.json
    const firstMes = json.data.first_mes
    const results: CheckResult[] = []

    const hasStatus = firstMes.includes(PLACEHOLDER_STATUS)
    const statusRegexes = this.project.regexes.filter(
      (r) => r.scriptName === '状态栏界面' || r.scriptName === '对AI隐藏状态栏'
    )
    results.push({
      name: '状态栏占位',
      passed: hasStatus && statusRegexes.length === 2,
      message:
        hasStatus && statusRegexes.length === 2
          ? undefined
          : '开场白缺少 <StatusPlaceHolderImpl/> 或配对正则缺失',
      fixes: hasStatus ? ['补正则'] : ['补占位符']
    })

    const createCardOpenings = this.project.openings.filter((o) => o.type !== 'text')
    const hasCreateRegexes = this.project.regexes.some((r) => r.scriptName === '角色创建卡片')
    if (createCardOpenings.length > 0 || hasCreateRegexes) {
      const hasCreate = createCardOpenings.every((o) => o.text.includes(PLACEHOLDER_CREATE_CARD))
      const createRegexes = this.project.regexes.filter(
        (r) => r.scriptName === '角色创建卡片' || r.scriptName === '对AI隐藏创建卡片'
      )
      results.push({
        name: '创建卡片占位',
        passed: hasCreate && createRegexes.length === 2,
        message: '创建卡片/混合开场白缺少占位符或配对正则缺失',
        fixes: ['补占位符', '补正则']
      })
    }
    return results
  }

  checkMvuFeatures(): CheckResult[] {
    const json = this.project.card.json
    const scripts = json.data.extensions?.tavern_helper?.scripts ?? {}
    const hasBundle = Object.values(scripts).some(
      (s) => s.type === 'script' && s.enabled && s.content.includes('MagVarUpdate')
    )
    const entries = json.data.character_book?.entries ?? []
    const hasInitVar = Object.values(entries).some(
      (e) => e.comment.includes('[InitVar]') && e.enabled === false
    )
    return [
      {
        name: 'MVU 特征',
        passed: hasBundle && hasInitVar,
        message:
          !hasBundle || !hasInitVar ? '缺少 MagVarUpdate 脚本或禁用的 [InitVar] 条目' : undefined,
        fixes: !hasBundle || !hasInitVar ? ['一键补 MVU'] : undefined
      }
    ]
  }

  checkUtf8(): CheckResult {
    try {
      const json = JSON.stringify(this.project.card.json)
      Buffer.from(json, 'utf-8')
      return { name: 'UTF-8', passed: true }
    } catch {
      return { name: 'UTF-8', passed: false, message: '内容含非法字符' }
    }
  }

  run(): ValidationReport {
    const checks: CheckResult[] = []
    checks.push(this.checkStructure())
    checks.push(this.checkRequiredFields())
    checks.push(...this.checkRegexes())
    checks.push(...this.checkRegexPairs())
    checks.push(...this.checkMvuFeatures())
    checks.push(this.checkUtf8())
    const ok = checks.every((c) => c.passed)
    return { checks, ok }
  }
}

export { compileRegex }
