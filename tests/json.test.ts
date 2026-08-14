// LLM 输出解析（extractJsonArray / fixJsonEscapes / extractFirstArray）冒烟
import { extractJsonArray, fixJsonEscapes, extractFirstArray } from '../src/shared/json'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  OK  ${msg}`)
  else {
    console.error(`  FAIL  ${msg}`)
    failures++
  }
}

const A = [
  {
    scriptName: '变量更新中美化',
    findRegex: '/<(update)>\\s*$/gsi',
    replaceString: 'x',
    promptOnly: false,
    markdownOnly: true,
    placement: [1, 2],
    runOnEdit: false
  },
  {
    scriptName: '变量更新美化',
    findRegex: '/<(update)>\\s*<\\/\\1>/gsi',
    replaceString: 'y',
    promptOnly: false,
    markdownOnly: true,
    placement: [1, 2],
    runOnEdit: false
  }
]

// 1. 纯 JSON 数组
{
  const r = extractJsonArray(JSON.stringify(A))
  assert(r.ok && r.value?.length === 2, '纯 JSON 数组解析成功')
}

// 2. ```json 代码块包裹
{
  const r = extractJsonArray('```json\n' + JSON.stringify(A) + '\n```')
  assert(r.ok && r.value?.length === 2, '```json 代码块包裹可解析')
}

// 3. 前后解释文字 + 数组
{
  const r = extractJsonArray('好的，这是优化后的正则：\n' + JSON.stringify(A) + '\n以上请查收～')
  assert(r.ok && r.value?.length === 2, '前后解释文字中提取数组成功')
}

// 4. 无效转义 \s 修复（LLM 常把 \\s 写成 \s）
{
  const broken = JSON.stringify(A).replaceAll('\\\\s', '\\s').replaceAll('\\\\/\\\\1', '\\/\\1')
  const r = extractJsonArray(broken)
  assert(r.ok && r.value?.length === 2, '无效转义 \\s 修复后可解析')
  const v = r.value as Array<{ findRegex: string }>
  assert(v[0].findRegex.includes('\\s'), '修复后 findRegex 保留单反斜杠 \\s')
}

// 5. 合法 \\s 不被 fixJsonEscapes 破坏
{
  const fixed = fixJsonEscapes('"/<(update)>\\\\s*$/"')
  assert(fixed === '"/<(update)>\\\\s*$/"', '合法 \\\\s 不被过度修复')
  const fixed2 = fixJsonEscapes('"/<(update)>\\s*$/"')
  assert(fixed2 === '"/<(update)>\\\\s*$/"', '无效 \\s 被修复为 \\\\s')
}

// 6. 提取平衡数组：字符串内含 [ ] 与嵌套数组
{
  const text = '前缀 [{"content":"含[方括号]字符","list":[1,{"x":2}]}] 后缀'
  const arr = extractFirstArray(text)
  assert(
    arr === '[{"content":"含[方括号]字符","list":[1,{"x":2}]}]',
    '平衡括号提取正确（含嵌套与字符串内括号）'
  )
  const r = extractJsonArray(text)
  assert(
    r.ok && (r.value as Array<{ content: string }>)[0].content === '含[方括号]字符',
    '提取出的数组可解析且字符串内括号保留'
  )
}

// 7. 非数组输出 → 失败但带错误信息
{
  const r = extractJsonArray('{"a": 1}')
  assert(!r.ok && typeof r.error === 'string', '非数组输出返回失败与错误信息')
}

// 8. 空/垃圾输入 → 失败
{
  const r = extractJsonArray('抱歉我无法完成')
  assert(!r.ok, '无数组内容返回失败')
}

if (failures) {
  console.error(`JSON 解析测试失败 ${failures} 项`)
  process.exit(1)
}
console.log('JSON 解析测试 OK')
