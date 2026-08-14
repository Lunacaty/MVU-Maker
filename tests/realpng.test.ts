// 扫描 Tavern 目录全部 PNG 角色卡，验证读取成功率（目录不存在则跳过）
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { extractCharaJson } from '../src/main/png/chunks'

const dir = 'E:/Pictures/Tavern'
if (!existsSync(dir)) {
  console.log('SKIP  Tavern 目录不存在，跳过真实卡测试')
  process.exit(0)
}

const files = readdirSync(dir).filter((f) => {
  try {
    return f.endsWith('.png') && statSync(`${dir}/${f}`).size > 300000
  } catch {
    return false
  }
})

let ok = 0
let fail = 0
const failures: string[] = []
const specs: Record<string, number> = {}

for (const f of files.slice(0, 120)) {
  try {
    const buf = readFileSync(`${dir}/${f}`)
    const json = extractCharaJson(buf)
    if (json) {
      const parsed = JSON.parse(json)
      specs[parsed.spec] = (specs[parsed.spec] ?? 0) + 1
      ok++
    } else {
      fail++
      failures.push(f)
    }
  } catch {
    fail++
    failures.push(f)
  }
}

console.log(`总 ${files.length}，成功 ${ok}，失败 ${fail}`)
console.log('spec 分布:', JSON.stringify(specs))
console.log('失败样本:', failures.slice(0, 10).join(' | '))
