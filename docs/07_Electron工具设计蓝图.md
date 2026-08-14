# 07 · Electron 工具设计蓝图

> 面向"专门为**已完成的纯文字角色卡**增加 MVU 变量、状态栏、角色创建卡片，
> 且支持自定义变量更新/美化正则、世界书与正则管理、全流程 LLM 辅助"的 Electron 桌面工具。
>
> 本文是**实现蓝图**：前端（Renderer）负责表单交互与画布，主进程（Main）负责读卡/改卡/写卡/校验，
> LLM 网关负责 AI 辅助，沙盒引擎负责实时预览。

---

## 目录

1. [功能范围](#1-功能范围)
2. [技术选型](#2-技术选型)
3. [总体架构](#3-总体架构)
4. [导航布局](#4-导航布局)
5. [数据模型](#5-数据模型)
6. [输入处理管线](#6-输入处理管线)
7. [改卡管线（核心）](#7-改卡管线核心)
8. [Schema 画布编辑器](#8-schema-画布编辑器)
9. [沙盒引擎](#9-沙盒引擎)
10. [开场白管理](#10-开场白管理)
11. [世界书 / 正则 / 脚本管理](#11-世界书--正则--脚本管理)
12. [LLM 辅助子系统](#12-llm-辅助子系统)
13. [变更传播矩阵](#13-变更传播矩阵)
14. [校验与验证](#14-校验与验证)
15. [导出与交付](#15-导出与交付)
16. [测试方案](#16-测试方案)
17. [风险与规避](#17-风险与规避)

---

## 1. 功能范围

### 核心（MVP）

- [x] 打开 PNG / JSON 角色卡（解析 `chara_card_v2`）
- [x] **Schema 画布编辑器**（vue-flow 平面画布，从空对象 `{}` 起逐一加字段）
- [x] 可视化配置 **MVU**（生成 schema.ts + Zod 脚本 + initvar + 三大提示词条目）
- [x] 一键注入 **状态栏**（完整 HTML 文档，纯原生 JS，可选主题）
- [x] 一键注入 **角色创建卡片**（捏人向导模板）
- [x] **开场白管理**：多条；每条约可选 纯文字 / 纯创建卡片 / 混合；每条可附加 initvar override
- [x] **世界书管理**：条目 CRUD、启停、蓝灯/绿灯切换、关键词/位置/深度编辑
- [x] **正则管理**：全部正则 CRUD + 顺序调整 + 实时测试
- [x] **酒馆助手脚本管理**：`tavern_helper.scripts` 文本编辑 + 启停
- [x] **自定义正则**：变量更新美化/折叠、占位符替换等（编辑器 + 沙盒预览）
- [x] **沙盒引擎**：状态栏 / 创建卡片 / 美化正则 / 开场白 实时预览，可改 mock 变量实时渲染
- [x] **LLM 辅助**：世界书、Schema、状态栏、创建卡片、更新美化正则、更新规则/格式均可由 AI 生成/优化（OpenAI 兼容）
- [x] 导出：PNG（保留原头像）或 JSON

### 不做

- 不做世界观/角色人设创作（那是 tavern-cards skill 的事）
- 不做聊天记录处理
- 不做前端 Vue 界面编译（状态栏走纯原生 JS，无构建；沙盒走 iframe 直载）

---

## 2. 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 桌面壳 | **Electron**（main + renderer + preload） | 用户指定；node 侧做文件与 PNG 处理 |
| 渲染层 | Vue 3 + Vite（renderer） | 画布/沙盒/多面板 UI 复杂度高，Vue 合适 |
| 画布 | `@vue-flow/core` | 节点编辑器现成能力：平移/缩放/连线/自定义节点 |
| PNG 处理 | `png-chunks-extract` / `png-chunk-text` / `png-chunks-encode` | 读取/写入 chara tEXt chunk，自动 CRC |
| YAML 解析 | `yaml` | initvar、更新规则 |
| zod 校验 | `zod`（v4）+ `jiti` | 加载用户 schema.ts 校验 initvar |
| 状态管理 | Pinia（renderer） | 项目/卡对象/画布/沙盒状态 |
| LLM 客户端 | `openai`（OpenAI 兼容 baseURL） | AI 辅助网关 |
| 文件对话框 | Electron `dialog` | 开卡/存卡 |
| 校验 | 自研（见 §14） | 结构 + 编码 + MVU 一致性 |

---

## 3. 总体架构

```
┌────────────────────────────── Electron ───────────────────────────────┐
│  Renderer (Vue3 + Vite)                   Main (node)                 │
│  ┌──────────────────────────────┐   IPC    ┌───────────────────────┐  │
│  │ 导航栏（左侧窄栏，分组图标）    │ ──────►  │ CardReader            │  │
│  │ ├ 总览 / 基本设置 / MVU / 其他 │ ◄──────  │ PatchEngine           │  │
│  │ Schema画布编辑器 (vue-flow)   │          │ Validator             │  │
│  │ 沙盒引擎 (iframe srcdoc)      │          │ PngPacker             │  │
│  │ 世界书/正则/脚本管理面板        │          │ LlmGateway            │  │
│  │ LLM 对话面板 × N              │          │ (OpenAI 兼容客户端)     │  │
│  │ AI 接入配置页                 │          │ SandboxBridge(mock)    │  │
│  └──────────────────────────────┘          └───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘

IPC 边界：
  renderer → main: { cmd: 'openCard'|'exportCard'|'validateInitvar'|'llmChat'|'sandboxExec'|... }
  main → renderer: 结果/错误/进度
  preload: contextBridge 暴露 window.cardTool = { openCard(), exportCard(), llmChat(), ... }
```

**安全**：开启 `contextIsolation: true`，`nodeIntegration: false`，通过 preload 白名单暴露 API。
**沙盒**：预览一律 `iframe.srcdoc`（不注入 node 能力，仅 mock 酒馆全局），见 §9。

---

## 4. 导航布局

**取消线性引导工作流**，改为导航栏，异步同框、自取所需。

```
┌──────┬──────────────────────────────────────────────────────────┐
│ 导航  │  内容区（当前功能面板）                                    │
│      │                                                          │
│ ● 总览 │  ● 总览：导入角色卡 / 卡信息 / 已注入功能清单 / 导出入口   │
│      │                                                          │
│ 基本设置│  开场白 · 世界书 · 正则 · 酒馆助手脚本                   │
│      │                                                          │
│ MVU  │  Schema编辑器 · 状态栏 · 变量更新美化 · 更新规则/格式       │
│      │                                                          │
│ 其他 │  AI 接入                                                  │
└──────┴──────────────────────────────────────────────────────────┘
```

- **左栏**：极窄（图标 + 短标签），分组标题可折叠
- **右栏**：大内容区，多面板可自由切换
- **总览页**：导入入口、卡片信息、已注入功能勾选态清单、导出按钮 + 校验报告
- **底部**：全局校验状态条（结构 ✓ / 编码 ✓ / MVU 一致 ✓ / 正则可编译 ✓ / initvar 过 schema ✓）

---

## 5. 数据模型

### 5.1 卡片对象（Main 进程持有）

```ts
type LoadedCard = {
  path: string;                 // 源文件路径
  format: 'png' | 'json';
  originalBuffer: Buffer;       // PNG 原字节（保留头像/其他 chunk）
  json: CharCardV2;             // 完整角色卡 JSON
  project: CardProject | null;  // 会话内工作数据（非持久）
};
type CharCardV2 = {
  spec: 'chara_card_v2';
  spec_version: string;
  data: {
    name: string;
    description: string;
    first_mes: string;
    alternate_greetings: string[];
    character_book: { name: string; entries: WorldEntry[] };  // entries 为数组（spec；ST entries.forEach）
    extensions: {
      regex_scripts: RegexScript[];
      tavern_helper: { scripts: HelperScript[]; variables: Record<string, any> };  // scripts 为数组（新版酒馆助手）
    };
    // ... 其他 v2 字段
  };
};
```

### 5.2 会话项目（非持久，Renderer 持有）

```ts
type CardProject = {
  schemaCanvas: SchemaCanvas;                         // 画布数据
  openings: Opening[];                                // 开场白列表
  llmConfig: LlmConfig;                               // AI 全局配置
  llmHistories: Record<AiFeatureId, LlmMsg[]>;        // 各 AI 功能点对话历史
  regexManager: RegexScript[];                        // 正则工作副本（含顺序）
  worldbookManager: WorldEntry[];                     // 世界书工作副本
  scriptsManager: Record<string, HelperScript>;       // 脚本工作副本
};

type Opening = {
  key: string;                        // 主开场白 / alternate_greetings[i]
  text: string;                       // 正文
  type: 'text' | 'createCard' | 'mixed';
  initvarOverride?: string;           // <UpdateVariable><initvar>…</initvar></UpdateVariable> 的 YAML 内容
};
```

### 5.3 Schema 画布数据

```ts
type SchemaCanvas = {
  root: ObjectNode;                   // 主 Schema 根（= z.object 根）
  palettes: ObjectNode[];             // 匿名副对象（游离字段组容器）
};
type ObjectNode = {
  id: string;
  label: string;                      // 根固定 "Schema"；副对象默认 "未命名对象"
  fields: FieldNode[];
  position: { x: number; y: number }; // 画布坐标
};
type FieldNode = {
  id: string;
  name: string;                       // 字段名（可含 _ 只读 / $ 隐藏 前缀）
  type: FieldType;                    // string|number|boolean|enum|record|object|union
  childObject?: ObjectNode;           // object 类型：内联子对象
  recordValue?: ObjectNode;           // record 类型：value 结构
  numberConfig?: { clamp?: [number, number]; int?: boolean; prefault?: number };
  enumValues?: string[];
  stringConfig?: { prefault?: string };
  describe?: string;                  // .describe('说明')
};
```

### 5.4 AI 配置（Renderer 持久化到用户数据目录）

```ts
type LlmConfig = {
  baseUrl: string;                    // OpenAI 兼容 baseURL
  apiKey: string;
  model: string;                      // 全局默认模型
  perFeatureModel?: Record<AiFeatureId, string>;   // 每功能覆盖
  maxRetries?: number;                // LLM 自修循环上限（默认 2）
};
```

### 5.5 工具配置（持久化）

```ts
type ToolConfig = {
  cardPath?: string;                  // 最近打开的卡
  llm: LlmConfig;
  statusBar: { themeId: string; customHtml: string };
  createCard: { customHtml: string };
  openingTemplates: Record<string, string>;   // 开场白模板库
};
```

---

## 6. 输入处理管线

```
选择文件 → CardReader.load(path)
   ├─ 扩展名 .json → JSON.parse → 校验 spec == 'chara_card_v2'
   ├─ 扩展名 .png → extract chunks → chara tEXt → JSON.parse
   └─ 失败 → 友好报错（"不是有效的角色卡"）
→ 展示卡片信息（name / description / 条目数 / 现有正则 / 现有脚本）
→ 检测 MVU 特征（scripts 有 MagVarUpdate / 存在禁用 [InitVar] 条目）
   → 提示"已增强"或"可重复注入"
→ 初始化会话项目：
   ├─ 从 zod 脚本反推 schema 画布（贴 zod → 反推，见 §8.4）
   ├─ 开场白：主 + alternate_greetings，提取已有 <UpdateVariable><initvar> 块
   ├─ 世界书条目 / 正则 / 脚本 → 工作副本
   └─ 幂等检测：已注入功能 → 勾选态 + 提示可二次编辑
```

---

## 7. 改卡管线（核心）

> 全部改动通过一个 `PatchEngine` 完成，每个"加一个功能"是一个**幂等 patch**（已存在则跳过）。
> 世界书/正则/脚本管理产生的用户改动也走 patch，统一落盘。

```
PatchEngine.apply(json, patches)
  for patch of patches:
    检查目标路径是否存在 → 已存在则 skip（幂等）→ 否则执行修改
```

### 7.1 Patch：加 MVU

1. **MVU 脚本** → `data.extensions.tavern_helper.scripts.MVU`
   ```jsonc
   { "type": "script", "enabled": true, "id": uuid(),
     "content": "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'",
     "info": "", "button": { "enabled": true, "buttons": [{"name":"重新处理变量","visible":true}] }, "data": {} }
   ```
2. **Zod 脚本** → `...scripts.Zod`，内容由 schema 画布生成：
   ```js
   import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
   export const Schema = z.object({ ... });
   $(() => { registerMvuSchema(Schema); });
   ```
3. **四个世界书条目** → `data.character_book.entries`（数组，新 uid 追加，见 §11 字段约定；位置按 MVU 官方标准：atDepth=4）：
   - `[InitVar]请勿打开`：content = initvar YAML，`enabled:false`（必须禁用），蓝灯，@D(atDepth=4) depth 4，order 200
   - `变量列表`：模板 + 权威声明，蓝灯，@D(atDepth=4) depth 0，order 200
   - `[mvu_update]变量更新规则`：更新规则 YAML，蓝灯，@D(atDepth=4) depth 0，order 200
   - `[mvu_update]变量输出格式`：输出格式模板，蓝灯，@D(atDepth=4) depth 4，order 200
4. **占位符** → `data.first_mes` 末尾追加 `\n\n<StatusPlaceHolderImpl/>`（含占位符则跳过）
5. 若无 `data.extensions.tavern_helper` → 先建 `{ scripts:[], variables:{} }`（scripts 为数组，新版酒馆助手要求）
6. 若无 `data.extensions.regex_scripts` → 先建 `[]`

### 7.2 Patch：加状态栏

1. `data.extensions.regex_scripts` push 两条：
   - `对AI隐藏状态栏`：`promptOnly:true, markdownOnly:false, replaceString:""`
   - `状态栏界面`：`markdownOnly:true, promptOnly:false, replaceString = 生成的完整HTML(含首尾三反引号)`
2. 生成 HTML = 完整文档结构（§9 铁律）+ 主题模板 + 变量字段绑定（从 schema 列主角/世界分组可勾选）

### 7.3 Patch：加角色创建卡片

1. `data.first_mes` 追加 `<CreateCardPlaceHolder/>`（按所选开场白类型，见 §10）
2. push 两条正则：`对AI隐藏创建卡片` + `角色创建卡片`（替换为捏人 HTML）
3. 确保 schema 里有 `主角` 分组与 `系统日志` 字段（否则提示补 schema）

### 7.4 Patch：开场白 initvar override

```
对每条 Opening（非纯文字且设置了 initvarOverride）：
  在文本末尾嵌入：
    ---
    <UpdateVariable>
    <initvar>
    （YAML）
    </initvar>
    </UpdateVariable>
  → 幂等：已有 <UpdateVariable><initvar> 块则整体替换
  → 校验：YAML 必须过 schema（§14）
```

### 7.5 Patch：世界书 / 正则 / 脚本管理（用户改动）

- 世界书：条目新增/编辑/删除/启停/蓝绿灯/关键词/位置深度 → 写回 `character_book.entries`
- 正则：CRUD + **顺序调整**（push/移动）→ 写回 `regex_scripts`
- 脚本：CRUD + 启停 → 写回 `tavern_helper.scripts`
- 全部幂等（按 scriptName / comment / id 判重）

### 7.6 Patch：自定义正则

```
用户添加条目 → 校验 findRegex 可编译（new RegExp）→ push 到 regex_scripts
```

---

## 8. Schema 画布编辑器

### 8.1 画布构成（vue-flow）

- **1 个主 Schema 根节点**：即 `Schema = z.object({...})`，固定存在、不可删除，节点标题"Schema"
- **N 个匿名副对象节点**：游离在画布上的字段组容器，`palettes[]`
- 字段以**行**形式内嵌在对象节点内（字段名 + 类型徽标 + 子结构编辑按钮）
- 对象类型字段可**展开为内联子对象**，也可**拆下成为副对象**（见 8.2）

### 8.2 核心操作

| 操作 | 行为 |
|------|------|
| **拼接** | 副对象整体并入主 Schema（或任意对象节点），其字段成为该节点的子字段；可选"保留副本"或"删除原副对象" |
| **拆下** | 主 Schema（或对象）任一层字段组抽出为副对象，独立编辑后再拼回；对象字段的深度编辑即临时拆下 |
| 复制粘贴 | 字段 / 副对象 Ctrl+C / Ctrl+V；跨副对象可粘贴；剪贴板为内部 JSON 结构 |
| 移动 | 节点拖拽平移 |
| 视野 | 滚轮缩放、拖空白平移、双击背景复位 |
| 定位主 Schema | 工具栏按钮 / 快捷键：视野中心对准根节点并缩放适配 |

### 8.3 生成规则（画布 → zod，主方向）

映射见 [03](03_MVU实现文档.md) §3.1：

```
对象节点   → z.object({ 字段... })
object字段 → z.object({...childObject 字段})
record字段 → z.record(z.enum([...]) | z.string().describe('键'), ...recordValue 结构)
数值字段   → z.coerce.number().transform(v => _.clamp(v, min, max)).prefault(0)
整数       → z.coerce.number().int().transform(clamp).prefault(0)
文本字段   → z.string().prefault('')
布尔字段   → z.boolean().prefault(false)
枚举字段   → z.enum([...])（提示：会限制 AI 自然表达，仅 EJS 精确匹配时用）
只读字段   → 前缀 _（AI 可见不可改）
隐藏字段   → 前缀 $（AI 不可见不可改）
describe   → .describe('说明')
```

**生成约定**：
- 根字段不用 `.optional()`；用 `.prefault()` 而非 `.default()`
- 幂等性：`Schema.parse(Schema.parse(x)) === Schema.parse(x)`
- 输出的 schema.ts 禁止 `import`（`z`/`_` 运行时注入）

### 8.4 反推（zod 代码 → 画布）

导入已有卡的 Zod 脚本时，轻量解析 zod 源码重建画布：
- `z.object({...})` → 对象节点字段
- `z.record(...)` → record 字段
- `z.enum([...])` / `z.coerce.number()` / 前缀 `_`/`$` / `.describe()` 语义提取
- 解析失败 → 退回"纯代码模式"（画布仅显示根节点 + 只读代码块），提示可手动重构

### 8.5 Schema 相关面板联动

- **initvar 编辑器**：YAML textarea + 实时校验（jiti 加载生成代码，注入全局 z/_，`Schema.parse(yaml)`）；支持从 schema 生成骨架
- **状态栏绑定**：schema 字段树 → 勾选要展示的变量路径
- **更新规则**：schema 字段树 → 生成 `type`/`range` 占位，AI 补 check

---

## 9. 沙盒引擎

### 9.1 通用机制

- 所有预览用 `iframe.srcdoc` 加载**完整 HTML 文档**（见下），通过 `SandboxBridge` 注入 mock 全局：

| mock 全局 | 行为 |
|-----------|------|
| `getVariables({type,message_id})` | 返回 mock stat_data |
| `getCurrentMessageId()` / `getLastMessageId()` | 固定常量 |
| `updateVariablesWith(fn, opt)` | 把 fn 结果写回 mock 数据并触发重渲染 |
| `eventOn(Mvu.events.*, cb)` | 注册本地事件，变更时触发 |
| `Mvu`（经 `waitGlobalInitialized`） | mock 的 `getMvuData/replaceMvuData/parseMessage` |
| `$` / `_` / `z` / `YAML` / `toastr` | 简化 stub 或真实注入 |

- 外部脚本一律走本地（无 CDN 依赖），iframe `sandbox="allow-scripts allow-same-origin"`

### 9.2 内联 HTML 铁律（状态栏/创建卡片/美化替换）

1. **必须有完整文档结构**：`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>…</style></head><body>…<script>…</script></body></html>`
2. 只用原生 JS（DOM API）；不依赖 `$`/`Vue`/`z`（消息楼层 iframe 的全局不可靠）
3. 渲染走字符串拼接 + `esc()` 转义；交互用事件委托（`closest('[data-act]')`）
4. `setInterval` 每 2s 轮询 + `Mvu.events.VARIABLE_UPDATE_ENDED` 触发刷新
5. 每个函数 `safe()` try/catch；动画分支 `return` 不触发全量 render
6. 改变量用 `updateVariablesWith` + `_.set`
7. 不依赖浏览器原生对话框（confirm/alert/prompt）

> 沙盒与酒馆运行时共用同一套 HTML，因此沙盒即"验收环境"。

### 9.3 各面板沙盒

| 面板 | 沙盒内容 |
|------|---------|
| **状态栏** | 右栏变量 mock 树（编辑 stat_data）→ 左栏 iframe 实时重渲染；按钮交互写回 mock 再渲染 |
| **创建卡片** | 同一环境，可走完"填写 → 提交 → mock 变量变化 → 收起"全流程 |
| **变量更新美化** | 测试文本 → 应用正则（隐藏/中美化/美化三选）→ 替换前/后 Markdown 渲染对照 |
| **开场白** | 按所选类型渲染（纯文字 / 纯创建卡片 / 混合），含占位符替换后的结果 |

---

## 10. 开场白管理

- 列表管理主开场白（`first_mes`）与备用开场白（`alternate_greetings`）
- 每条：**纯文字** / **纯创建卡片** / **混合**（剧情文本 + 创建卡片占位）
- 每条可附加 **initvar override**（YAML 编辑 + schema 实时校验），导出时嵌入（§7.4）
- 每条可沙盒预览（§9.3）
- 模板库：内置"纯文字/混合"常用开场白骨架，可存用户模板
- MVU 硬前提检查：若所有开场白皆空 → 提示"该卡无开场白，MVU 无法初始化变量"

---

## 11. 世界书 / 正则 / 脚本管理

### 11.1 世界书

- 条目表格：comment / 蓝灯 / 绿灯 / keys / position / depth / enabled / insertion_order
- CRUD + 启停切换 + 关键词编辑 + 位置/深度下拉
- 与 MVU 注入条目区分：标记"MVU 自动条目"（只读保护，防止误删，可在设置中解锁）
- LLM 辅助入口（§12）：从零生成 / 选中条目增量改写

### 11.2 正则

- 全量列表（scriptName / findRegex / 方向徽标 promptOnly·markdownOnly / 启用）
- CRUD + **顺序调整**（上移/下移/拖拽），顶部说明"顺序影响渲染管道"
- 每条字段：findRegex / replaceString / placement 复选 / promptOnly / markdownOnly / runOnEdit / minDepth / maxDepth
- **实时测试**：测试文本 → 替换预览（Node 侧 `new RegExp` 跑一遍）
- 预置模板库：变量更新美化（完整/未闭合/隐藏）、状态栏占位、创建卡片占位

### 11.3 酒馆助手脚本

- `tavern_helper.scripts` 列表：脚本名 / enabled / 类型
- 文本编辑（monaco，JS 高亮）+ 启停开关
- MVU / Zod 脚本标"MVU 自动脚本"，只读保护 + 可解锁
- 校验：启用脚本的 import URL 可达性提示

---

## 12. LLM 辅助子系统

### 12.1 LLM 网关

- OpenAI 兼容客户端（baseURL + apiKey + model），全局一组配置
- 每个 AI 功能点可**覆盖 model**（`perFeatureModel`）
- 适配器模式：当前实现 OpenAI 兼容，预留其他 provider 扩展位
- 流式输出（SSE）到对话面板

### 12.2 知识注入（关键设计）

> 这些专用格式 LLM 并不知道，**必须把精炼知识写进系统提示词上下文**。

| AI 功能点 (AiFeatureId) | 注入的系统知识 | 输出校验（§14） |
|---|---|---|
| `schema` 设计/优化 | 03§3.1 生成规则、zod 类型速查、`_`/`$` 前缀语义、幂等性铁律、03§10 报错表 | jiti+zod 试编译 + initvar 试 parse |
| `worldbook` 从零/增量 | 01§3 条目字段、蓝/绿灯、位置/深度、YAML 约定 | 条目必填字段校验 |
| `statusbar` | 04 方案C 铁律、完整 HTML 结构要求、可用 API 签名、04§7 设计规范 | HTML 结构检查 + 沙盒渲染冒烟 |
| `createcard` | 05§3 流程、04 铁律、schema 一致性提醒（写入字段必须在 schema） | 同上 |
| `regexbeautify` | 03§5 正则五件套、JSON 反斜杠双写规则、深度微调 | `new RegExp` 试跑 |
| `updaterules` 更新规则/格式 | 03§3.3 字段表（type/range/category/check/value）、03§4.2 格式标记语义 | YAML 可解析 + 路径匹配 schema |

**上下文组装**（每个功能点一次请求）：

```
system = 角色定位 + 知识段落（上表）+ 输出格式硬约束（如"只输出 zod 代码块"）
user   = 当前卡上下文（角色名/描述/现有 schema 摘要/所选变量路径…）
       + 用户个性化需求（自由输入框，每轮可改）
       + 默认范式（可选：来自 通用mvu构建提示词.txt / docs 模板，用户可"用它生成"）
```

### 12.3 对话式面板

- 每个 AI 功能点一个对话区，历史保留，可**增量迭代**（"再优化一下主角分组"）
- 每轮带**个性化需求输入框**（相对指令，会并入下一轮 user 消息）
- 动作按钮：`生成` / `应用`（把结果导入画布/面板）/ `复制` / `重试`
- 失败反馈闭环：校验失败 → 错误信息自动回传 LLM → 自修重试（上限 `maxRetries`）

### 12.4 默认范式

- 内置建议模板，直接可用或作为起点：
  - Schema 范例（`通用mvu构建提示词.txt` 第 1~13 条 → 完整 Schema 示例）
  - 状态栏视觉规范（神秘紫 + 华丽金、进度条、Tab 导航、折叠动画…）
  - 创建卡片（名称/身份/外貌/偏好世界观多选…）
  - 变量更新美化正则三件套
- 每个功能面板首屏展示"从这里开始"范式卡片

---

## 13. 变更传播矩阵

修改 schema 时提醒同步（复用 [03](03_MVU实现文档.md) 的矩阵）：

| 变更 | schema 画布 | initvar | 更新规则 | 状态栏绑定 | 世界书 |
|------|-----------|---------|---------|-----------|--------|
| 新增变量 | ✓ | 加默认值 | 非自明则加 | 可选勾选 | enum 值需描述 |
| 改名 | ✓ | 同步 | 同步 | 同步 | — |
| 删除 | ✓ | 删 | 删 | 删绑定 | — |
| 改类型 | ✓ | 过校验 | 同步 type | 影响渲染 | enum 需描述 |

工具在"导出前校验"阶段自动扫描：schema 字段 vs initvar 字段 vs 状态栏 `stat_data.` 引用，
报告不一致项并给出修复按钮。

---

## 14. 校验与验证

导出前自动跑：

| 检查 | 实现 |
|------|------|
| 结构合法 | `JSON.parse(JSON.stringify(obj))` 往返一致 |
| spec/必填字段 | 校验 `spec`、`data.name`、`data.first_mes` |
| 正则可编译 | `new RegExp(findRegex 去首尾 /flags)` 每个都试跑 |
| 正则编码 | findRegex 中 `\s`/`\1` 等是否已正确转义（JSON 里应是 `\\s`/`\\1`） |
| initvar 过 schema | jiti 加载生成的 schema.ts + `Schema.parse(yaml)`（含各开场白 override） |
| MVU 特征 | 存在 MagVarUpdate 脚本 + 存在禁用 `[InitVar]` 条目 |
| 状态栏占位 | `first_mes` 含 `<StatusPlaceHolderImpl/>` + 两条正则配对 |
| 创建卡片占位 | 含 `<CreateCardPlaceHolder/>` + 两条正则配对 |
| 开场白类型一致性 | `createCard/mixed` 开场白必须存在创建卡片占位与配对正则 |
| 世界书条目引用 | 无失效 path（本工具内联，无文件引用问题）；MVU 自动条目未误删 |
| 脚本 import | 启用脚本的 CDN URL 可解析（提示可换镜像） |
| UTF-8 | 内容统一 UTF-8（含中文） |

校验报告 UI：通过项打勾 / 失败项红字 + 修复按钮（一键补缺）。

---

## 15. 导出与交付

### 15.1 输出格式选择

| 输入 | 默认输出 | 说明 |
|------|---------|------|
| PNG | PNG（保留头像） | 原像素 + 新 chara chunk |
| JSON | JSON | 无头像 |

### 15.2 导出流程

```
PatchEngine 全部 apply → validate() 通过 →
  无头像：writeFile(json)（2空格缩进）
  有头像：extract 原 chunk → 替换 chara → png-chunks-encode → writeFile(png)
→ 完成页：产物路径 + 校验摘要 + "新开聊天才能生效"提示
```

### 15.3 交付物说明

- 输出卡 = 增强后的完整角色卡，可直接拖进酒馆
- 使用前提（写进工具内提示/帮助）：
  1. 需要酒馆助手扩展
  2. MVU 仅聊天补全模式工作
  3. 导入后必须**新开聊天**（schema 变更不生效于旧聊天）
  4. 依赖 MVU 宏/模板的条目：**制作时禁用酒馆助手宏与提示词模板，游玩时启用**

---

## 16. 测试方案

| 层 | 方法 |
|----|------|
| 单元 | schema 画布↔zod 生成/反推、正则转义、YAML↔zod 校验、PNG chunk 编解码、LLM 提示词组装 |
| 集成 | 拿一张真实纯文字卡跑完整管线（世界书/正则/脚本管理 + MVU 注入），导出后再回读比对 |
| 回归 | 幂等性：同一张卡二次注入不产生重复条目/正则/脚本 |
| 沙盒 | 状态栏/创建卡片在沙盒内走完交互全流程，mock 变量实时渲染正确 |
| 验收 | 导出卡导入酒馆：新开聊天 → 状态栏出现、创建卡片可捏人、AI 回复输出变量更新、美化正则生效 |
| 冒烟 | 覆盖：无 MVU 的卡、已有 MVU 的卡、无开场白的卡、损坏 JSON、非 UTF-8 文件 |

---

## 17. 风险与规避

| 风险 | 规避 |
|------|------|
| 原卡有同名脚本/正则/条目 | 幂等 patch：key 已存在则跳过或询问覆盖；MVU 自动项只读保护 |
| `character_book` 已是独立引用 | 正常追加 entries 即可，uid 用最大+1 |
| 正则顺序影响显示 | 提供顺序调整 UI；提示用户顺序即渲染管道顺序 |
| CDN 不可达（MVU/Zod 脚本依赖 jsdelivr） | 文档提示换 `fastly.jsdelivr.net`；状态栏模板无外部依赖 |
| schema 校验太严格导致 AI 更新失败 | 编辑器默认"宽松模式"（少 enum、多 clamp/prefault） |
| 中文/转义导致 JSON 损坏 | 全程 JSON.stringify 统一编码；导出前校验报告 |
| 用户改了 schema 忘记同步 | 变更传播矩阵 + 导出前一致性扫描 |
| LLM 输出格式不对 | 系统提示词硬约束输出格式 + 校验回传自修循环 |
| LLM 知识盲区（专用格式） | 每个功能点注入精炼 docs 知识段落（§12.2） |
| 画布反推失败（复杂 zod） | 退回"纯代码模式"，画布仅显示根节点 + 只读代码 |
| 沙盒与酒馆行为不一致 | 沙盒共用同一份 HTML；验收测试覆盖酒馆实测 |
| 大卡 PNG 性能 | 只操作 chunk 数组，不重编码像素，毫秒级 |

---

## 附：与现有工具的配合

| 场景 | 用什么 |
|------|--------|
| 需要"项目目录 ↔ 卡"来回迭代的内容创作 | `tavern-cards-forge`（[06](06_构建工具文档.md)） |
| 需要 Vue 复杂前端界面 | `tavern_helper_template`（[04](04_状态栏编写文档.md) 方案 B） |
| 给成品卡一键增强 MVU/状态栏/捏人/世界书/正则 + LLM 辅助 | **本 Electron 工具** |
