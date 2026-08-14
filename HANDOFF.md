# MVU Maker · 项目交接文档（Handoff）

> 本文件写给**接手本项目的另一位 Agent**。目标是让你在不熟悉代码的情况下，
> 快速理解项目全貌、当前状态、已知问题与剩余工作，并顺利继续开发。
>
> 最后更新：2026-08-14 · 交接时的代码状态（所有测试通过）

---

## 0. 项目一句话定位

一个 **Electron 桌面工具**，专门为"**已经完成的纯文字 SillyTavern 角色卡**"（PNG/JSON）
一键增强 **MVU 变量系统 + 状态栏 + 角色创建卡片**，并支持世界书/正则/脚本管理与
全流程 **LLM 辅助**。它**不做内容创作**，只做"给成品卡注入 MVU 组件"。

---

## 1. 环境与启动

| 项 | 值 |
|---|---|
| 项目根目录 | `E:\Pictures\Tavern\MVU Maker` |
| Node | v22.22.3（需 ≥22） |
| 包管理器 | npm |
| 运行 | `npm run dev` |
| 测试 | `npm test` |
| 类型检查 | `npm run typecheck`（node + web 双端） |
| Lint | `npm run lint` |
| 构建产物 | `npm run build`（输出到 `out/`） |
| 打包安装包 | `npm run build:win` |

**⚠ 重要端口坑**：开发服务器端口固定为 **5210**（在 `electron.vite.config.ts`）。
不要改成 5173/5179——这两个端口在用户机器上落在 **Windows 保留端口段**（`5095-5194`），
绑定会报 `EACCES`。换端口前先 `netsh interface ipv4 show excludedportrange protocol=tcp` 查保留段。

**应用内 console.log 不进终端**：Electron renderer 的 `console.log` 默认只在 **DevTools（F12）** 显示。
要进终端需 `ELECTRON_ENABLE_LOGGING=1` 启动。

---

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 39 + electron-vite 5 |
| 渲染层 | Vue 3.5 + Vite 7 + TypeScript |
| 状态管理 | Pinia |
| Schema 画布 | @vue-flow/core（含 background/controls/minimap） |
| 表格/正则 | 原生实现 |
| PNG 处理 | png-chunks-extract / png-chunks-encode（自写 UTF-8 tEXt 解析） |
| YAML | yaml |
| zod | zod v4.4（+ jiti 动态加载 schema 校验） |
| LLM | openai SDK（OpenAI 兼容 baseURL） |
| 编辑器 | monaco-editor（已装，脚本编辑器暂未接） |

---

## 3. 目录结构

```
src/
├── main/                    # Electron 主进程（node）
│   ├── index.ts             # 入口，创建窗口，持有当前 CardProject
│   ├── ipc.ts               # 全部 IPC handler + buildCardJson（导出前组装）
│   ├── configStore.ts       # 工具配置 JSON 持久化（userData）
│   ├── project.ts           # 读卡后组装 CardProject + zod 脚本提取
│   ├── validator.ts         # 导出前校验（Validator 类）
│   ├── card/
│   │   ├── reader.ts        # CardReader（读 PNG/JSON，MVU 检测）
│   │   ├── initvar.ts       # jiti 加载 schema 校验 initvar YAML
│   │   └── templates.ts     # 【已移到 shared】见下
│   ├── patch/engine.ts      # PatchEngine（幂等注入 MVU/状态栏/创建卡片）
│   ├── llm/gateway.ts       # OpenAI 兼容 LLM 网关（流式）
│   └── png/
│       ├── chunks.ts        # PNG tEXt 宽容解析（UTF-8，支持 base64/v3）
│       └── packer.ts        # PNG/JSON 导出
├── preload/                 # contextBridge 暴露 window.cardTool
├── renderer/src/            # Vue 渲染层
│   ├── App.vue              # 外壳：左侧导航栏 + 右侧内容区 + toast
│   ├── main.ts              # 入口（含全局错误捕获）
│   ├── assets/base.css      # 全局主题（暗黑工具风 + 二次元背景）
│   ├── stores/
│   │   ├── nav.ts           # 导航状态
│   │   └── project.ts       # 当前 CardProject + toast
│   ├── components/
│   │   ├── SchemaCircle.vue # 画布节点（容器圆形/字段矩形，虚线虚拟节点）
│   │   ├── TreeEdge.vue     # 连接线（水平树状正交路径，实线+虚线）
│   │   ├── FieldInspector.vue # 字段详情面板
│   │   ├── SandboxIframe.vue  # 沙盒 iframe（mock 酒馆全局）
│   │   ├── LlmChatPanel.vue   # LLM 对话面板
│   │   └── NoCard.vue         # 未开卡占位
│   └── views/               # 11 个功能页（见 §6）
└── shared/                  # 三方共享（纯逻辑，无 node 依赖）
    ├── types.ts             # 所有领域类型（CharCardV2/SchemaCanvas/...）
    ├── ipc.ts               # IPC 契约（window.cardTool 签名）
    ├── schema.ts            # 【核心】画布 ↔ zod 双向编解码 + 布局算法
    ├── templates.ts         # MVU 注入模板（脚本/正则/世界书条目/美化）
    ├── regex.ts             # 正则按"替换目标"匹配工具
    └── llmPrompts.ts        # LLM 知识注入提示词（6 功能点）
tests/                       # 8 个测试文件（见 §7）
docs/                        # 技术文档（01-07 + 通用mvu构建提示词.txt）
```

**注意**：`src/main/card/templates.ts` 已废弃（内容移到 `src/shared/templates.ts`），
`main` 里用相对路径 `../shared/templates` 导入。

---

## 4. 核心数据模型

### 4.1 角色卡 `CharCardV2`（shared/types.ts）
支持 `chara_card_v2` 和 `chara_card_v3`。读取时还支持 **base64 编码的 chara chunk**（部分导出工具）。

### 4.2 Schema 画布 `SchemaCanvas`（shared/types.ts + shared/schema.ts）
**扁平节点图**模型：
```ts
interface SchemaCanvas { nodes: SchemaNode[] }
interface SchemaNode {
  id: string
  name: string
  type: 'string'|'number'|'boolean'|'enum'|'record'|'object'|'union'|'root'
  parentId: string | null   // 父子树：object/record/root/union 是容器
  position: { x: number; y: number }
  numberConfig?: { clampMin?; clampMax?; int?; prefault? }
  enumValues?: string[]; enumPrefault?: string
  stringPrefault?: string; booleanPrefault?: boolean
  describe?: string
}
```
根节点 id 恒为 `'root'`（`ROOT_NODE_ID`）。

**关键概念**（改代码前必读）：
- `isContainer(node)` = object/record/root（**圆形视觉**）
- `canHaveChildren(node)` = object/record/root/**union**（**能收子节点/有虚线**）
- 成员位置由**算法**计算，不自由摆放；拖动 = 整个结构一起移动
- 空闲虚线 = 容器的"第 N+1 个虚拟成员"，用 `TreeEdge` 的 dashed 边渲染（几何与实线完全一致）

### 4.3 布局常量（shared/schema.ts 顶部）
```
CONTAINER_SIZE=92  RECT_HEIGHT=44  TRUNK_LEN=60  LINK_LEN=90
SNAP_RADIUS=44  MEMBER_GAP=76
```
- `containerSlots(canvas, containerId)`：返回各成员的 yOffset（线末端相对容器主干中心的偏移）+ 空闲虚线槽位
- `memberPosition(canvas, container, slot)`：成员**左缘**对准线末端，竖直中心对准
- `subtreeSpan(canvas, id)`：子树竖直跨度（含虚线预留，容器按 N+1 成员算）
- `layoutCanvas(canvas)`：读取脚本后自动展开布局
- `relayoutContainer(canvas, containerId)`：重排某容器成员
- `collectSubtree(canvas, id)`：收集子树 id（带环保护）

### 4.4 会话项目 `CardProject`（shared/types.ts）
```ts
interface CardProject {
  card: LoadedCard            // { path, format, json }
  schemaCanvas: SchemaCanvas
  openings: Opening[]         // 开场白（含 initvar override）
  regexes: RegexScript[]
  worldbookEntries: WorldInfoEntry[]
  scripts: Record<string, HelperScript>
  mvuDetected: boolean
}
```

---

## 5. 核心机制

### 5.1 读取卡片
`ipc.ts` 的 `card:open`：对话框选文件 → `readCard` → `buildProject`（组装会话项目）→ 存主进程。

### 5.2 注入管线（PatchEngine）
`buildCardJson(project)`（ipc.ts）导出前把所有工作数据合成最终卡：
1. 开场白 initvar override 嵌入
2. 开场白文本写回
3. 世界书/正则/脚本工作副本写回
4. 注入 MVU 组件（脚本 + 4 世界书条目 + 状态栏占位符）
所有 patch 幂等（已存在则跳过）。

### 5.3 Schema 双向编解码（shared/schema.ts）
- `canvasToZodCode(canvas)`：画布 → zod 代码字符串（无 export，`z.object({...})`）
- `zodToCanvas(code)`：zod 代码 → 画布（自动 layoutCanvas 展开）
- `extractSchemaExprFromScript(content)`：从酒馆助手 Zod 脚本提取 `export const Schema = ...`
- 解析支持多行链式（`z\n.object(...)` 已规整）、prefault/clamp/describe/enum/record/union

### 5.4 Schema 画布交互（SchemaView.vue）
- **右键按下**出菜单：空白=环形新建（可按住拖动选类型松手创建）；成员=操作菜单（复制/解绑/删除/改类型）；Shift+右键=全局菜单（粘贴/定位/撤销/重做）
- **拖动任意节点 = 整个结构一起平移**（用 `dragOrig` Map 缓存原始位置 + 总位移同步）
- **拖拽连接预览**：拖游离节点靠近容器虚线时高亮虚线 + 被拖节点半透明
- 撤销/重做：Ctrl+Z / Ctrl+Y，20 条历史
- 复制/粘贴：复制整个子树（**深拷贝用 JSON 往返，不能用 structuredClone——Pinia 的 Proxy 无法克隆**）

### 5.5 沙盒（SandboxIframe.vue）
iframe srcdoc 注入 mock 酒馆全局（getVariables/updateVariablesWith/eventOn/Mvu/lodash-like）。
状态栏/创建卡片/开场白预览都靠它。

### 5.6 正则以"替换目标"匹配（shared/regex.ts）
`matchRegexByTarget(regexes, target)` 按 findRegex 的匹配目标（非名称）找正则，
用于导入时读取既有状态栏/美化正则作为编辑底稿。

### 5.7 PNG 处理（main/png/chunks.ts）
**自写 tEXt 解析**（不用 png-chunk-text，它对中文抛错）：
- 支持 tEXt/iTXt/zTXt，UTF-8 内容，不校验 CRC
- 支持 chara 内容为 **base64**（常见）
- 支持 chara_card_v3

---

## 6. 功能页（views/）当前状态

| 页面 | 状态 | 说明 |
|---|---|---|
| Overview | ✅ 完成 | 导入卡、功能卡片、已注入清单、使用前提 |
| SchemaView | ✅ 基本完成 | 画布编辑、预览代码、LLM、脚本加载 |
| OpeningsView | 🟡 有已知问题 | 见 §8 |
| WorldbookView | ✅ 完成 | 条目 CRUD/蓝绿灯/关键词/位置深度 |
| RegexView | ✅ 完成 | 列表/编辑/排序/实时测试 |
| ScriptsView | ✅ 完成 | 脚本列表（可读名）/编辑/启停 |
| StatusBarView | ✅ 完成 | 主题模板 + 沙盒 + 手动指认正则 |
| CreateCardView | ✅ 完成 | 模板 + 沙盒 + 手动指认正则 |
| BeautifyView | ✅ 完成 | 双美化正则（更新中/完成）+ 注入 |
| UpdateRulesView | 🟡 简化版 | 只有文本编辑（三大提示词条目），无沙盒 |
| ExportView | ✅ 完成 | 校验报告 + 导出 |
| AiView | ✅ 完成 | LLM 配置（全局 + 每功能覆盖） |

---

## 7. 测试（npm test）

| 文件 | 覆盖 |
|---|---|
| smoke.test.ts | schema 编解码 + PatchEngine 注入 + Validator + initvar 校验 |
| canvas.test.ts | 画布完整性（反推/嵌套/record/真实脚本） |
| realparse.test.ts | 真实多行 zod 脚本解析（6 顶层字段全还原） |
| layout.test.ts | 自动布局展开（同级不重叠、子树跨度、虚线预留） |
| slots.test.ts | 槽位算法（中心偏移、空闲虚线位置） |
| copy.test.ts | 复制/粘贴子树（id 重映射、父子保留、鼠标位置） |
| png.test.ts | PNG 读/写/导出（中文 UTF-8 保真） |
| realpng.test.ts | 扫描真实卡目录（**不在 npm test 里**，手动跑） |

**注意**：`realpng.test.ts` 不在 package.json 的 test 里（避免每次扫 100+ 张真实卡）。
`npm test` 跑 7 个文件，全部通过。

---

## 8. 已知问题（接手后优先处理）

### 8.1 开场白页"选中后 Nav 失效"（未解决，需复现定位）
**现象**：进开场白页 → 选中一个开场白（编辑器 iframe 打开）→ 再选中另一个开场白 →
此时左侧导航按钮点击无效，无法切换页面。

**已做的排查/修复尝试**：
- Nav 按钮已改 `@mousedown.prevent` 触发 + `[nav] mousedown go` 日志
- `main.ts` 已加全局 `errorHandler`（打印 `[vue-error]`）和 `unhandledrejection`
- 代码静态分析未发现 Nav 被覆盖（Nav 在左侧 aside，编辑区在右侧 content）

**接手建议**：让用户按 F12 开 DevTools，复现后看：
- 是否有 `[nav] mousedown go xxx` 日志 → 有=渲染问题（看 `[vue-error]`）；无=事件被拦截
- 重点排查 SandboxIframe 的 iframe 是否拦截事件（可能是根因）

### 8.2 UpdateRulesView 过于简化
只有三大提示词条目的文本编辑，没有：schema 联动、LLM 面板接入、沙盒。可增强。

### 8.3 生成代码预览的代码框用 textarea（只读）
`SchemaView.vue` 的 `generatedCode` 用 textarea 显示，语法高亮弱。可换 monaco 或简单高亮。

---

## 9. 建议的下一步（未开始的工作）

按优先级：

1. **修 8.1 开场白 Nav bug**（当前最影响使用的已知问题）
2. 增强 UpdateRulesView（LLM 面板 + schema 联动 + YAML 校验）
3. 接入 monaco-editor 做脚本/代码编辑器的语法高亮
4. 完善 SchemaView 生成代码预览（高亮）
5. 打包发布：`npm run build:win`（需确认 electron-builder.yml 的图标/产物名）
6. 状态栏/创建卡片 LLM 的"按原基础优化"模式：目前 LLM 面板有 featureId，但"从头/优化"切换未完全实现

---

## 10. 开发约定

- **深拷贝必须用 `JSON.parse(JSON.stringify(x))`**，不要用 `structuredClone`（Pinia 的 Proxy 会抛错）
- **shared/ 不能 import node 模块**（渲染层共用）；main/ 可
- 正则字符串里的 `\1`/`\s` 在 TS 源里用 `String.raw\`...\`` 或双反斜杠，避免 TS 报 octal escape
- 代码风格：不写注释（除非必要）；按 eslint/prettier（`npm run lint`，可 `eslint --fix`）
- 修改配置类文件后要重启 opencode 才生效
- 改布局常量（MEMBER_GAP 等）后要跑 `npm test`（slots/layout 测试断言这些值）

---

## 11. 关键文件速查（改哪看哪）

| 需求 | 文件 |
|---|---|
| 改 Schema 画布逻辑/布局算法 | `shared/schema.ts` + `renderer/views/SchemaView.vue` |
| 改画布节点/连线视觉 | `components/SchemaCircle.vue` + `components/TreeEdge.vue` |
| 改注入内容 | `shared/templates.ts` + `main/patch/engine.ts` + `main/ipc.ts#buildCardJson` |
| 改 IPC 接口 | `shared/ipc.ts` + `main/ipc.ts` + `preload/index.ts` |
| 改领域类型 | `shared/types.ts` |
| 改校验 | `main/validator.ts` + `main/card/initvar.ts` |
| 改 PNG 读写 | `main/png/chunks.ts` |
| 改 LLM 提示词 | `shared/llmPrompts.ts` + `main/llm/gateway.ts` |
| 改导航/外壳 | `renderer/App.vue` + `stores/nav.ts` |
| 改主题 | `renderer/assets/base.css` |
| 改某个功能页 | `renderer/views/<Page>.vue` |

---

## 12. 领域知识（务必配合 docs/ 阅读）

项目根 `docs/` 有 7 份权威技术文档 + `通用mvu构建提示词.txt`：
- `01_角色卡基础知识.md`：PNG/JSON、世界书、正则、脚本、宏
- `03_MVU实现文档.md`：MVU 架构、schema/initvar/更新规则、正则五件套、Mvu 接口
- `04_状态栏编写文档.md`：状态栏三方案（工具用方案 C 纯原生 JS）
- `05_角色创建卡片编写文档.md`：捏人卡片实现
- `06_构建工具文档.md`：tavern-cards-forge、PNG 打包细节
- `07_Electron工具设计蓝图.md`：**本工具的设计蓝图（已按讨论更新）**

遇到 SillyTavern/MVU 专用格式问题，**优先查这些 docs**。也可加载 skills：
`tavern-card-builder`、`tavern-cards`、`tavern-ui`、`sillytavern-api-reference`、
`sillytavern-card-pipeline` 等（都在 `~/.config/opencode/skills/`）。

---

## 13. 给接手 Agent 的第一件事

1. `npm install`（如 node_modules 缺失）
2. `npm run typecheck` + `npm test` + `npm run lint` 确认基线全绿
3. `npm run dev` 启动，导入一张真实 PNG 卡（`E:\Pictures\Tavern\` 下有很多）跑一遍 Schema 编辑/导出
4. 复现 §8.1 的开场白 Nav bug，定位并修复
