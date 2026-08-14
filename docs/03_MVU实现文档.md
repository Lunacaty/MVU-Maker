# 03 · MVU 实现文档

> MVU（Magical Variable Update）是酒馆助手（Tavern-Helper）的变量框架，由
> [MagicalAstrogy/MagVarUpdate](https://github.com/MagicalAstrogy/MagVarUpdate) 提供。
> 它让 AI 在回复末尾输出结构化命令，酒馆助手解析后更新 `stat_data` 变量，
> 实现数值/状态/物品等"可演化状态"的持久化追踪。

**本文档是给纯文字角色卡注入 MVU 的权威操作手册。** 读完本文 + [01](01_角色卡基础知识.md)，即可手工/自动化地为任意卡片加 MVU。

---

## 目录

1. [架构总览](#1-架构总览)
2. [组件清单与链路](#2-组件清单与链路)
3. [三大核心文件](#3-三大核心文件)
4. [模板文件（收尾注入）](#4-模板文件收尾注入)
5. [正则五件套](#5-正则五件套)
6. [Mvu 接口详解](#6-mvu-接口详解)
7. [路径对照与变量前缀](#7-路径对照与变量前缀)
8. [双 AI 模式（额外模型解析）](#8-双-ai-模式额外模型解析)
9. [Electron 工具注入清单](#9-electron-工具注入清单)
10. [常见问题与排错](#10-常见问题与排错)

---

## 1. 架构总览

```
                    ┌──────────────────────────────────────────────┐
                    │                角色卡（PNG/JSON）               │
                    │                                              │
  ┌─────────────────┼──────────────────────────────────────────────┼──────────────┐
  │  酒馆助手脚本     │  世界书条目                                   │  正则脚本      │
  │  (tavern_helper │  (character_book)                           │  (regex)      │
  │   .scripts)      │                                              │              │
  │                  │  [InitVar]请勿打开(禁用)   → 初始值           │  [不发送]去除   │
  │  MVU 脚本        │  变量列表(蓝灯@D0)         → AI看变量+权威声明  │  变量更新       │
  │  (导入 MagVar    │  [mvu_update]变量更新规则  → AI看更新条件      │  [美化]变量更新中 │
  │  Update bundle)  │  [mvu_update]变量输出格式  → AI学输出JSONPatch │  [美化]完整变量更新│
  │                  │                                              │  [不发送]界面占位符│
  │  Zod 脚本        │  [界面]状态栏占位符 ←─ AI 回复末尾自动附加      │  [界面]状态栏    │
  │  (registerMvu    │                                              │                 │
  │   Schema)        │                                              │                 │
  └─────────────────┼──────────────────────────────────────────────┼──────────────┘
                    └──────────────────────────────────────────────┘

  AI 回复末尾输出:
  <UpdateVariable>
  <Analysis>...</Analysis>          ← 思维链（时间/戏剧性/逐变量check）
  <JSONPatch>[ {op,path,value}, ... ]</JSONPatch>   ← RFC6902 命令
  </UpdateVariable>

  酒馆助手: 解析命令 → zod 校验/钳制 → 更新 stat_data → 存回楼层 → 事件广播
  状态栏:   {{format_message_variable::stat_data}} 宏 或 Mvu.getMvuData() 读取
```

**数据流**：`初始化(initvar) → 每轮AI输出命令 → 校验 → 写回 stat_data → 显示/发送`。

变量存在聊天楼层消息的 `data.stat_data`（`message` 级变量），初始值来自世界书 `[InitVar]` 条目。

---

## 2. 组件清单与链路

给一张卡加 MVU，需要**7 类组件**：

| # | 组件 | 位置 | 作用 |
|---|------|------|------|
| 1 | **MVU 脚本** | `extensions.tavern_helper.scripts.MVU` | 导入 MagVarUpdate 框架本体 |
| 2 | **Zod 脚本** | `extensions.tavern_helper.scripts.Zod` | `registerMvuSchema(Schema)` 注册变量结构 |
| 3 | **schema.ts** | 项目文件（打包时编译进 Zod 脚本） | zod 定义变量结构（唯一权威） |
| 4 | **initvar 条目** | 世界书 `[InitVar]请勿打开`（**禁用**） | YAML 初始值 |
| 5 | **三大提示词条目** | 世界书 变量列表 / 更新规则 / 输出格式 | 让 AI 知道变量、何时改、怎么改 |
| 6 | **正则五件套** | `extensions.regex_scripts` | 隐藏+美化变量更新、占位状态栏 |
| 7 | **开场白占位符** | `data.first_mes` 末尾 | `<StatusPlaceHolderImpl/>` |

**组件链路（唯一数据源原则）**：

```
schema.ts ──► initvar.yaml（必须通过 schema 校验）
    │
    └──► 变量更新规则.yaml（type/range 与 schema 一致）
    │
    └──► Zod 脚本（打包时从 schema.ts 自动生成）
```

> 改 schema → 必须同步 initvar 与更新规则（见 [07](07_Electron工具设计蓝图.md) 的变更传播矩阵）。

---

## 3. 三大核心文件

### 3.1 变量结构 schema.ts（Zod 4）

**编写原则**：
- 变量名自明（`好感度` 不用解释）
- **幂等性**：`Schema.parse(Schema.parse(x)) === Schema.parse(x)`
- 禁止 `{{user}}` 宏做 key（运行时才替换，key 需编译期确定）
- 尽量 `z.object()` 而非 `z.array()`；根字段不用 `.optional()`
- `z.enum` 节制（限制 AI 自然表达），仅 EJS 精确匹配或用户明确要求时用
- 用 `z.coerce.number()` 而非 `z.number()`（自动字符串转数值）
- 用 `.transform(v => _.clamp(...))` 钳制而非 `.min().max()`（min/max 是拒绝，clamp 是修正）
- 用 `.prefault()` 而非 `.default()`（AI 省略字段时自动填默认）

```ts
export const Schema = z.object({
  世界: z.object({
    当前时间: z.string(),
    当前地点: z.string(),
  }),
  白娅: z.object({
    依存度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(35),
    着装: z.record(
      z.enum(['上装', '下装', '内衣', '袜子', '鞋子', '饰品']),
      z.string(),
    ),
  }),
  主角: z.object({
    物品栏: z.record(
      z.string().describe('物品名'),
      z.object({
        描述: z.string(),
        数量: z.coerce.number().prefault(1),
      }),
    ).transform(data => _.pickBy(data, ({ 数量 }) => 数量 > 0)),
  }),
});
export type Schema = z.output<typeof Schema>;
```

**Zod 类型速查**：

| 用途 | 写法 |
|------|------|
| 固定字段对象 | `z.object({ ... })` |
| 动态键对象 | `z.record(键类型, 值类型)` |
| 限定可选键 | `z.partialRecord(z.enum([...]), 值类型)` |
| 固定+可扩展 | `z.intersection(z.object({...}), z.record(...))` |
| 数值 | `z.coerce.number()` |
| 整数 | `z.coerce.number().int()` |
| 文本 | `z.string()` |
| 布尔 | `z.boolean()` |
| 枚举 | `z.enum(['A','B'])` |
| 联合 | `z.union([A, B])` 或 `A.or(B)` |
| 缺省值 | `.prefault(值)` |
| 钳制 | `.transform(v => _.clamp(v, 0, 100))` |
| 描述 | `.describe('说明')` |

> **schema.ts 禁止任何 `import` 语句**——`z` 与 `_` 为运行时全局注入。打包工具用 jiti 加载时注入。

### 3.2 初始变量 initvar.yaml

YAML 格式，结构必须与 schema 对应，打包时嵌入 `[InitVar]` 条目内容。

```yaml
世界:
  当前时间: 2024-04-08 10:45
  当前地点: 教室
白娅:
  依存度: 35
  着装:
    上装: 校服外套
    下装: 百褶裙
主角:
  物品栏:
    道具A:
      描述: 道具描述
      数量: 1
```

**`[InitVar]` 条目三铁律**：
1. 条目名包含 `[InitVar]`
2. **必须 `enabled: false`**（禁用状态才生效——它是"初始值数据库"不是"每轮发送的提示词"）
3. 角色卡必须有开场白，MVU 才能初始化变量

**另一种初始化**：开场白末尾 `<initvar>` 块（全量覆盖）：

```
开局剧情...

<UpdateVariable>
<initvar>
（完整 YAML，格式同上）
</initvar>
</UpdateVariable>
```

或用 `<JSONPatch>` 增量修改：

```
<UpdateVariable>
<JSONPatch>
[
  { "op": "replace", "path": "/白娅/依存度", "value": 50 },
  { "op": "insert", "path": "/主角/物品栏/新道具", "value": { "描述": "新", "数量": 1 } }
]
</JSONPatch>
</UpdateVariable>
```

> `initvar` 和 `JSONPatch` 可出现在任意楼层（含用户输入），MVU 逐楼层链式更新。

### 3.3 变量更新规则 变量更新规则.yaml

告诉 AI 每个变量"何时改、改多少、改成什么"。**每个变量路径下可用的字段**：

| 字段 | 用途 |
|------|------|
| `type` | 变量接受的值类型（AI 看不到 schema，这里声明） |
| `range` | 数值范围 |
| `category` | 范围分段释义 |
| `format` | 格式要求（如时间格式） |
| `check` | **核心**：更新条件与规则（列表） |
| `value` | 变量值的语义说明 |

```yaml
---
变量更新规则:
  世界:
    当前时间:
      format: ${YYYY/MM/DD}-${HH:MM}
      check:
        - 每次事件推进、休息或旅行后更新
  白娅:
    依存度:
      type: number
      range: 0~100
      check:
        - 根据白娅对<user>行为的感知调整 ±(3~6)
        - 仅在白娅察觉到<user>行为时才更新
  主角:
    装备栏.${部位}:
      type: |-
        {
          装备: string; // 未装备用"空置"
          主角评价: string;
        }
      check:
        - 穿戴、损毁、替换装备时更新
    物品栏:
      type: |-
        {
          [物品名: string]: { 描述: string; 数量?: number; }
        }
      check:
        - 获取、消耗、丢弃物品时更新
        - 数量归零后自动消失
```

**编写原则**：
- 变量名自明（如 `当前地点`）可省略 check
- 同类变量用 `${键1|键2}` 合并
- `_`/`$` 前缀只读变量不写更新规则
- `z.record` 动态键名放 `type` 里解释，路径里写静态前缀

---

## 4. 模板文件（收尾注入）

### 4.1 变量列表（变量列表.txt）→ 蓝灯，@D0/D1

```text
---
<status_current_variable>
{{format_message_variable::stat_data}}
</status_current_variable>

## 数据权威声明

以下 stat_data 变量列表是角色当前状态的**唯一权威数据来源**。
- 所有数值（积分、好感度、HP、MP、数量等）一律以本列表为准
- 大总结、小总结、动向、小圈子等记忆内容中提到的旧数值仅供参考，可能已过时，**不得**用来覆盖本列表
- 更新变量时，必须基于本列表当前值计算增减，而不是基于记忆文本中的数值
- 若记忆与列表冲突，以本列表为准
```

> **"数据权威声明"必须保留**：防止 LLM 把记忆文本里的旧数值当成真实数额导致状态错乱。

可选择性展示（拆多条、分别控蓝灯）：

```text
---
<status_current_variable>
世界:
  {{format_message_variable::stat_data.世界}}
白娅:
  依存度: {{format_message_variable::stat_data.白娅.依存度}}
</status_current_variable>
```

### 4.2 变量输出格式（变量输出格式.txt）→ 蓝灯，@D0

```yaml
---
<update_variable_rules>
rule:
  - you must output the update analysis and the actual update commands at once in the end of the next reply
  - 'the update commands must strictly follow the **JSON Patch (RFC 6902)** standard, but can only use the following operations: `replace` (replace the value of existing paths), `add` (only used to insert new items into an object or array), `remove`; that is, the output must be a valid JSON array containing operation objects'
format: |-
  <UpdateVariable>
  <Analysis>（中文，不超过350字）
    0. 时间: 根据剧情进展，判断是否需更新当前时间。
    1. 主角: 检查名称、状态、所处地点……是否变化。
    2. ……
  </Analysis>
  <JSONPatch>
  [
    { "op": "replace", "path": "${/path/to/variable}", "value": ${new_value} },
    { "op": "add", "path": "${/path/to/object/newKey}", "value": ${content} },
    { "op": "remove", "path": "${/path/to/array/0}" },
    ...
  ]
  </JSONPatch>
  </UpdateVariable>
</update_variable_rules>
```

**格式标记语义**：
- `${描述}`：AI 替换为具体内容
- `$(要求)`：AI 只听从不输出标记
- `...`：仿照示例继续输出
- 其余原样输出

**操作符**（MagVarUpdate 支持 5 种，比 RFC6902 多 delta）：

| 操作 | 说明 |
|------|------|
| `replace` | 替换已存在路径的值 |
| `delta` | 数值增减（`{ "op": "delta", "path": "/白娅/依存度", "value": 5 }`） |
| `add` / `insert` | 往对象/数组插入新项（数组用 `-` 表示追加到末尾） |
| `remove` | 删除 |
| `move` | 移动 |

### 4.3 变量更新强调（可选，防模型不听话）

```yaml
---
变量输出格式强调:
  rule: The following must be inserted to the end of reply, and cannot be omitted
  format: |-
    <UpdateVariable>
    ...
    </UpdateVariable>
```

### 4.4 条目前缀 `[mvu_plot]` / `[mvu_update]`

双 AI 模式下路由用：
- `[mvu_plot]`：只发给剧情 AI
- `[mvu_update]`：只发给变量更新 AI
- 无前缀：两个 AI 都发
- 位置不限（`[mvu_update]变量更新规则` 与 `变量更新规则[mvu_update]` 等价）

---

## 5. 正则五件套

### 5.1 完整清单（注入 `extensions.regex_scripts`）

| 正则名 | findRegex | 关键字段 | 作用 |
|--------|-----------|---------|------|
| **对AI隐藏变量更新** | `/<(update(?:variable)?)>(?:(?!.*<\/\1>)(?:(?!<\1>).)*$|(?:(?!<\1>).)*<\/\1?>)/gsi` | `promptOnly:true, placement:[1,2]` | 从 AI 上下文删掉历史 `<UpdateVariable>`（防照抄、省 token） |
| **变量更新中美化** | `/<(update(?:variable)?)>(?!.*<\/\1>)\s*((?:(?!<\1>).)*)\s*$/gsi` | `markdownOnly:true, placement:[1,2]` | 未闭合标签显示"正在更新..."提示，`$2`=内容 |
| **变量更新美化** | `/<(update(?:variable)?)>\s*((?:(?!<\1>).)*)\s*<\/\1>/gsi` | `markdownOnly:true, placement:[1,2]` | 完整标签美化为可折叠面板，`$2`=内容 |
| **对AI隐藏状态栏** | `<StatusPlaceHolderImpl/>` | `promptOnly:true, placement:[2]` | 从 AI 上下文删占位符 |
| **状态栏界面** | `<StatusPlaceHolderImpl/>` | `markdownOnly:true, placement:[2]` | 占位符换成状态栏 HTML |

> JSON 中正则反斜杠双写：`\s` → `\\s`，`\1` → `\\1`。

### 5.2 三版美化正则的匹配策略

- **完整版**：匹配 `<update>内容</update>`（已闭合）→ 显示正式折叠面板
- **未闭合版**：`(?!.*<\/\1>)` 负向前瞻保证后面没有闭合标签 → 显示"正在更新"提示（AI 还在生成时前端先渲染）
- **隐藏版**：用 `|` 同时匹配完整/未闭合两种 → 统一替换为空

> ⚠ **替换产物禁止 `<style>`/`<script>` 标签**（沙盒 iframe 会剥离 head 样式）：所有 CSS 必须内联在元素的 `style` 属性里；`@keyframes` 动画无法内联，不用动画，用静态样式（边框/底色/斜体/加粗）表达状态。

### 5.3 深度微调

`对AI隐藏变量更新` 默认隐藏所有楼层。若 AI 因看不到已做的更新而重复更新，可设 `minDepth: 4` 保留最近 1~2 楼发给 AI。深度对应：

```
深度 3 → 倒数第 4 楼（上上次 AI 回复）
深度 2 → 倒数第 3 楼（上一次用户输入）
深度 1 → 倒数第 2 楼（上一次 AI 回复）
深度 0 → 倒数第 1 楼（本次用户输入）
```

---

## 6. Mvu 接口详解

### 6.1 前置条件

所有使用 MVU 的脚本/界面开头：

```js
await waitGlobalInitialized('Mvu');
```

### 6.2 数据与命令结构

```ts
type MvuData = {
  initialized_lorebooks: Record<string, any[]>;  // 已初始化的世界书列表
  stat_data: Record<string, any>;                // 实际变量数据
  [key: string]: any;
};

type CommandInfo =
  | { type: 'set';    full_match: string; args: [path, new] | [path, old, new]; reason: string }
  | { type: 'insert'; full_match: string; args: [path, value] | [path, idx, value]; reason: string }
  | { type: 'delete'; full_match: string; args: [path] | [path, key]; reason: string }
  | { type: 'add';    full_match: string; args: [path, delta]; reason: string }
  | { type: 'move';   full_match: string; args: [from, to]; reason: string };
```

> 注意：`Mvu` 底层命令模型是 `set/insert/delete/add/move` 五类（从 `<JSONPatch>` 的
> RFC6902 操作映射而来），`COMMAND_PARSED` 事件里 `command.args[0]` 就是变量路径。

### 6.3 事件

| 事件 | 触发时机 | 回调参数 |
|------|---------|---------|
| `Mvu.events.VARIABLE_INITIALIZED` | 新开聊天初始化完成 | `(variables, swipe_id)` |
| `Mvu.events.VARIABLE_UPDATE_STARTED` | 一轮更新开始 | `(variables)` |
| `Mvu.events.COMMAND_PARSED` | 命令解析完成（**可修改**） | `(variables, commands[], message_content)` |
| `Mvu.events.VARIABLE_UPDATE_ENDED` | 更新结束（**可修改结果**） | `(variables, variables_before_update)` |
| `Mvu.events.BEFORE_MESSAGE_UPDATE` | 变量写入楼层前 | `({ variables, message_content })` |

**COMMAND_PARSED 用途示例**（修复 gemini 在中文间加的 `-` / 繁体字 / 追加命令）：

```js
await waitGlobalInitialized('Mvu');
eventOn(Mvu.events.COMMAND_PARSED, (variables, commands) => {
  commands.forEach(cmd => {
    cmd.args[0] = cmd.args[0].replaceAll('-', '');        // 修 `角色.络-络`
    cmd.args[0] = cmd.args[0].replaceAll('絡絡', '络络'); // 修繁体
  });
  // 追加一条强制命令
  commands.push({ type: 'set', full_match: '', args: ['角色.络络.好感度', 5], reason: '脚本强制' });
});
```

**VARIABLE_UPDATE_ENDED 用途示例**（钳制幅度/阈值触发/强行还原/清变量）：

```js
await waitGlobalInitialized('Mvu');
eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (new_vars, old_vars) => {
  // 钳制幅度 ±5
  const old_val = _.get(old_vars, 'stat_data.白娅.依存度');
  _.update(new_vars, 'stat_data.白娅.依存度', v => _.clamp(v, old_val - 5, old_val + 5));

  // 阈值突破
  if (old_val < 50 && _.get(new_vars, 'stat_data.白娅.依存度') >= 50) {
    toastr.success('白娅依存度突破50!');
  }

  // 强行还原某变量（阻止 AI 改）
  _.set(new_vars, 'stat_data.某变量', _.get(old_vars, 'stat_data.某变量'));

  // 死亡清变量
  if (_.get(new_vars, 'stat_data.青空莉.死亡') === true) {
    _.unset(new_vars, 'stat_data.青空莉');
  }
});
```

### 6.4 主动读写

```js
await waitGlobalInitialized('Mvu');

const vars = Mvu.getMvuData({ type: 'message', message_id: -1 });              // 最新楼
const vars = Mvu.getMvuData({ type: 'message', message_id: 'latest' });        // 同上
const vars = Mvu.getMvuData({ type: 'message', message_id: -2 });              // 倒数第二楼
const vars = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() }); // 当前界面楼层

// 修改并写回
_.update(vars, 'stat_data.白娅.依存度', v => v + 5);
await Mvu.replaceMvuData(vars, { type: 'message', message_id: getCurrentMessageId() });
```

### 6.5 解析文本命令

```js
await waitGlobalInitialized('Mvu');
const old_data = Mvu.getMvuData({ type: 'message', message_id: -1 });
const content = "<JSONPatch>[{...}]</JSONPatch>";  // 来自某处文本
const new_data = await Mvu.parseMessage(content, old_data);
await Mvu.replaceMvuData(new_data, { type: 'message', message_id: getCurrentMessageId() });
```

### 6.6 请求 AI 生成并更新（生成式玩法）

```js
await waitGlobalInitialized('Mvu');
const old_data = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
const message = await generate({ user_input: '你好' });
const data = await Mvu.parseMessage(message, old_data);

// A: 只更新变量到当前楼层
await Mvu.replaceMvuData(data, { type: 'message', message_id: getCurrentMessageId() });
// B: 回复+变量一起建楼
await createChatMessages([{ role: 'assistant', message, data }]);
```

### 6.7 用变量激活绿灯（injectPrompts）

```js
await waitGlobalInitialized('Mvu');
eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, variables => {
  const value = _.get(variables, 'stat_data.白娅.依存度');
  let stage = '阶段一';
  if (value >= 80) stage = '阶段五';
  else if (value >= 60) stage = '阶段四';
  else if (value >= 40) stage = '阶段三';
  else if (value >= 20) stage = '阶段二';

  injectPrompts([{
    id: '激活-白娅阶段',
    content: `白娅${stage}`,   // 绿灯关键词匹配此内容
    position: 'none',
    depth: 0,
    role: 'user',
    should_scan: true,          // 关键：允许用于绿灯扫描
  }]);
});
```

条件性激活写法：

```js
injectPrompts([{
  id: '激活-依存度最低事件',
  position: 'none', depth: 0, role: 'system',
  content: '【【依存度最低时立即事件】】',
  filter: () => _.get(getAllVariables(), 'stat_data.白娅.依存度') === 0,
  should_scan: true,
}]);
```

### 6.8 EJS 读取（世界书条目内）

| 函数 | 用途 |
|------|------|
| `getvar('stat_data.白娅.依存度')` | 取值 |
| `getvar('stat_data.路径', { defaults: 0 })` | 取值带兜底 |
| `getAllVariables()` | 最新楼层全部变量 |
| `<%= YAML.stringify(getvar('stat_data'), { blockQuote: 'literal' }) %>` | YAML 展示 |

> 依赖 MVU 宏/模板的条目：**制作时禁用酒馆助手宏与提示词模板，游玩时启用**。

---

## 7. 路径对照与变量前缀

### 7.1 三种路径写法（同一变量）

| 场景 | 格式 | 示例 |
|------|------|------|
| EJS `getvar` / 宏 | 点分隔，带 `stat_data.` | `stat_data.白娅.依存度` |
| AI JSON Patch | 斜杠分隔，**无** `stat_data.` | `/白娅/依存度` |
| YAML initvar | 嵌套 | `白娅: { 依存度: 35 }` |

### 7.2 变量名前缀

| 前缀 | AI 可见 | AI 可更新 | 用途 |
|------|---------|-----------|------|
| 无 | ✅ | ✅ | 普通变量 |
| `_` | ✅ | ❌（提示词告知不更新，脚本可更新） | 展示给 AI 的派生状态 |
| `$` | ❌（`{{format_message_variable}}` 不展示） | ❌ | 隐藏状态（AI 不可见自然无法更新） |

---

## 8. 双 AI 模式（额外模型解析）

酒馆"额外模型解析"（Extra Model Analysis）可让两个模型分工：一个写剧情、一个算变量。
MVU 通过条目前缀路由：

- `[mvu_plot]` 条目 → 只发给剧情 AI
- `[mvu_update]` 条目 → 只发给变量更新 AI
- 无前缀 → 两个 AI 都发

检测是否处于额外模型解析：`Mvu.isDuringExtraAnalysis()`。
`[mvu_update]` 前缀下，变量输出格式可以更"命令化"（无剧情时不需要 Analysis 叙事）。

---

## 9. Electron 工具注入清单

> 面向"纯文字卡 → MVU 增强卡"的自动化注入。完整工程流程见 [07](07_Electron工具设计蓝图.md)。

给一张卡加 MVU 的**最小改动**（JSON 视角）：

```jsonc
{
  "spec": "chara_card_v2",
  "data": {
    "first_mes": "（原开场白）\n\n<StatusPlaceHolderImpl/>",   // ① 末尾追加占位符
    "character_book": {
      "name": "xxx",
      "entries": [   // ③ entries 必须是数组（chara_card_v2 spec；ST 会 entries.forEach）
        { "keys":[], "secondary_keys":[], "comment":"[InitVar]请勿打开",
          "content":"（initvar YAML）", "constant":true, "selective":false,
          "insertion_order":200, "enabled":false, "position":"@D",
          "extensions":{ "position":4, "depth":4, "role":0, "order":200 },
          "id":0 },
        { "...": "变量列表条目（蓝灯，@D depth0，order 200）" },
        { "...": "[mvu_update]变量更新规则条目（蓝灯，@D depth0，order 200）" },
        { "...": "[mvu_update]变量输出格式条目（蓝灯，@D depth4，order 200）" }
      ]
    },
    "extensions": {
      "regex_scripts": [ /* 五件套正则，见 §5 */ ],
      "tavern_helper": {
        // ④ scripts 必须是数组（酒馆助手 JS-Slash-Runner 的 Zod 校验要求；
        //    写成对象会被静默丢弃，表现为"卡里没有脚本"）
        "scripts": [
          { "type":"script", "name":"MVU", "enabled":true, "id":"<uuid>",
            "content":"import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'",
            "info":"", "button":{ "enabled":true, "buttons":[{ "name":"重新处理变量", "visible":true }] },
            "data":{}, "export_with":{ "data":true, "button":true } },
          { "type":"script", "name":"Zod", "enabled":true, "id":"<uuid>",
            "content":"import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\nexport const Schema = z.object({...});\n$( () => { registerMvuSchema(Schema); });",
            "info":"", "button":{ "enabled":true, "buttons":[] },
            "data":{}, "export_with":{ "data":true, "button":true } }
        ],
        "variables": {}
      }
    }
  }
}
```

### 脚本内容模板

**MVU 脚本**（框架本体）：

```
import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'
```

**Zod 脚本**（从 schema.ts 生成）：

```js
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({ /* 变量结构 */ });

$(() => {
  registerMvuSchema(Schema);
});
```

---

## 10. 常见问题与排错

| 症状 | 原因 | 处理 |
|------|------|------|
| 变量不更新 | 未用聊天补全 API；或没有开场白；或 `[InitVar]` 没禁用 | MVU 仅聊天补全模式工作；必须有开场白；`[InitVar]` 必须 `enabled:false` |
| 改 schema 后不生效 | 未新开聊天 | 修 schema/initvar 后**必须新开聊天** |
| `Mvu` 未定义 | 未等初始化 | `await waitGlobalInitialized('Mvu')` |
| 状态栏空白 | CDN 不可达 / 宏被禁用 | 检查 `testingcf.jsdelivr.net`；游玩时启用酒馆助手宏 |
| 宏路径空 | 路径与 schema 不一致 | 对照 schema 核对 `stat_data.` 路径 |
| AI 不输出 `<UpdateVariable>` | 模型/预设不听话 | 加"变量输出格式强调"条目；或换更强模型 |
| 变量出界被拒 | `.min().max()` 会拒绝更新 | 改用 `.transform(v => _.clamp(...))` |
| 数字被存成字符串 | schema 用 `z.number()` | 用 `z.coerce.number()` |
| 记忆旧数值污染 | 无权威声明 | 变量列表条目保留"数据权威声明"段 |
| 排错入口 | 魔棒 → 日志查看器 / 变量管理器 | 看 `【脚本|变量结构】`、`【脚本|MVU】` 日志；变量管理器可看每楼 `stat_data` |
