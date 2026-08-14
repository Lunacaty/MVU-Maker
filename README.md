# MVU Maker

> 为 **SillyTavern 角色卡**一键增强 **MVU 变量系统** 的桌面工具（Electron）。
> 可视化编辑变量结构（Schema）→ 注入 MVU 世界书 / 正则 / 酒馆助手脚本 / 状态栏 / 角色创建卡片 → 导出**酒馆可直接导入**的 PNG / JSON 角色卡。

MVU Maker 面向"已完成的纯文字角色卡"：无需手写任何代码，在图形界面里搭好变量结构，程序自动生成 Zod 脚本、变量初始化（`[InitVar]`）、变量更新规则、输出格式、状态栏与全套正则，最后导出与 SillyTavern 完全兼容的卡片文件。

---

## ✨ 功能特性

### Schema 变量结构画布
- 可视化搭建 `stat_data` 变量树：`string / number / boolean / enum / object / record / union` 七种类型
- 支持默认值（`prefault`）、数值钳制（`clamp`）、字段说明（`describe`）等 Zod 4 能力
- 画布 ↔ Zod 代码**双向转换**：可从任意 MVU 角色卡的 Zod 脚本反推画布，也可直接粘贴代码生成画布

### MVU 世界书管理
- 四大提示词条目一站式管理：
  | 条目 | 说明 |
  |------|------|
  | `[InitVar]请勿打开` | 变量初始化（**禁用**状态，MVU 引擎读取），注入时按 Schema **自动生成默认空值**，无需 LLM |
  | `变量列表` | 实时变量快照（蓝灯 @D0） |
  | `[mvu_update]变量更新规则` | 每个变量的更新触发条件 |
  | `[mvu_update]变量输出格式` | 要求 AI 以 JSON Patch 输出更新指令 |
- 条目位置自动对齐官方标准（`atDepth=4` + depth + `order=200`），导入酒馆不会错乱

### 正则脚本
- 变量更新五件套：隐藏 / 更新中 / 美化 / 隐藏状态栏 / 状态栏界面
- 内置正则测试沙盒：用示例文本实时预览替换结果
- **美化正则产物全部内联样式**（无 `<style>` 标签，酒馆沙盒 iframe 兼容）

### 酒馆助手脚本
- 脚本文本管理：查看、编辑、启停 MVU / Zod 等角色脚本
- Zod 脚本内容随画布自动生成（`registerMvuSchema`）

### 状态栏 & 角色创建卡片
- 状态栏：纯文本（宏替换）或 HTML 界面，内置沙盒 iframe 实时预览
- 角色创建卡片：开局捏人界面（占位符 + 两条正则），多步向导式
- 开场白管理：多条开场白 + 各自的 `initvar override`

### LLM 辅助（可选）
- 多服务商配置（OpenAI 兼容，任意 baseURL + apiKey + model）
- 各页面内置 AI 面板：Schema 设计、世界书、更新规则、状态栏、创建卡片、变量更新美化、开场白
- 所有任务提示词可在「LLM 提示词」页查看/编辑/导入导出；LLM 结构化输出有容错解析（代码块、解释文字、无效转义均能正确处理）

### 导出（酒馆兼容性保证）
- **PNG 导出保留原头像**：只替换 chara 数据块，像素原样字节拷贝
- chara / ccv3 以 **base64** 写入（与 SillyTavern `character-card-parser` 完全一致）
- `character_book.entries` 为**数组**（ST `convertCharacterBook` 要求）
- `tavern_helper.scripts` 为**数组**（新版酒馆助手 JS-Slash-Runner 要求，Record 会被静默丢弃）
- 导出后立即用**酒馆同款解析逻辑自检**，解析失败会明确警告
- 校验失败不阻止导出；默认文件名带时间戳，绝不覆盖源卡

### 会话持久化
- 项目自动保存（800ms 防抖），重启应用自动恢复上次工作现场

---

## 🚀 快速开始

### 环境要求
- Node.js ≥ 20
- npm ≥ 9

### 安装依赖

```bash
npm install
```

### 开发运行（热重载）

```bash
npm run dev
```

### 测试

```bash
npm test          # 全部测试：schema 编解码 / 画布布局 / PNG 读卡写卡 / LLM 解析 / initvar 骨架
npm run typecheck # TS 类型检查（node + web）
npm run lint      # ESLint + Prettier
```

### 打包

```bash
npm run build:win    # Windows NSIS 安装包 → dist/mvu-maker-<version>-setup.exe
npm run build:mac    # macOS
npm run build:linux  # Linux (AppImage / snap / deb)
npm run build:unpack # 免安装目录版 → dist/win-unpacked
```

打包产物同时包含免安装版（`dist/win-unpacked/`），拷走即用。

---

## 📖 使用流程

1. **打开角色卡**：导入 PNG / JSON 卡片（自动识别 MVU 特征）
2. **搭建 Schema**（Schema 页）：画布拖拽添加变量字段，或粘贴现有 Zod 代码反推
3. **编写 MVU 世界书**（MVU 世界书页）：编辑更新规则 / 输出格式，点「注入到世界书」——`[InitVar]` 条目自动按 Schema 生成
4. **注入组件**：状态栏 / 创建卡片 / 开场白（按需）
5. **导出**（导出页）：选 PNG 或 JSON → 保存 → 直接导入 SillyTavern

---

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 39 + electron-vite 5 |
| 前端 | Vue 3.5 + Pinia + Vue Flow（画布） + Monaco Editor |
| 后端 | Node.js（IPC 服务、PNG chunk 处理、LLM 网关） |
| 数据 | zod v4（Schema 校验）、yaml、JSON Patch |
| LLM | OpenAI SDK（任意兼容服务商） |

---

## 📁 目录结构

```
src/
├── main/                 # Electron 主进程
│   ├── card/             # 读卡、initvar 校验
│   ├── png/              # PNG chunk 解析 / 导出（字节级替换，CRC 自算）
│   ├── patch/            # PatchEngine：改卡管线（世界书/正则/脚本/开场白）
│   ├── llm/              # LLM 网关 + JSONL 日志
│   ├── configStore.ts    # 配置存储（userData，含多服务商 LLM 配置）
│   └── ipc.ts            # 全部 IPC 处理器
├── preload/              # 安全桥接
├── renderer/             # Vue 界面
│   └── src/views/        # 各功能页（Schema / 世界书 / 正则 / 脚本 / 状态栏 / 导出…）
└── shared/               # 前后端共享（类型 / 模板 / 提示词 / JSON 解析 / schema 编解码）
tests/                    # 冒烟 + 端到端测试（含酒馆真实解析器验证）
docs/                     # 技术文档集（角色卡 / ST 接口 / MVU / 状态栏…）
```

---

## 🔧 关键兼容性设计（踩坑记录）

| 问题 | 原因 | 本工具的解法 |
|------|------|-------------|
| 导入报 `Unexpected token '�'` | chara 内容需 **base64**，写裸 JSON 会被 ST 解成乱码 | 导出时 chara/ccv3 一律 base64（与 ST `write` 一致） |
| `characterBook.entries.forEach is not a function` | `entries` 必须为**数组**（spec） | 全程数组；读取端兼容对象形式自动归一化 |
| 卡里有脚本但酒馆助手看不到 | 新版酒馆助手要求 `tavern_helper.scripts` 为**数组**（元素含 `name`） | 导出转数组（含 `type/enabled/name/…/export_with`） |
| MVU 条目位置错乱 | `extensions.position` 6 是"示例消息之后"，`@D` 应为 **4**（atDepth） | 模板 + 注入 + 导出三重规范化（atDepth=4 + depth + order=200） |
| 美化正则样式丢失 | 沙盒 iframe 剥离 `<style>` 标签 | 全部改内联 `style` 属性，提示词同步约束 |

---

## 🔒 隐私说明

- **API Key 只存用户数据目录**（`%APPDATA%/mvu-maker/`），不在项目目录、不入 Git 仓库、不打包进产物
- 源码中的 `apiKey` 均为空默认值，无任何硬编码密钥
- LLM 请求日志写入用户目录 `logs/llm.log`，仅本机可见
- 会话项目自动保存到用户目录，不会随仓库/安装包分发

---

## 📚 相关文档

技术细节见 [`docs/`](docs/README.md) 文档集：

| 文档 | 内容 |
|------|------|
| [01 角色卡基础知识](docs/01_角色卡基础知识.md) | 卡片 JSON/PNG 格式、世界书、正则、脚本、宏、EJS |
| [02 ST 接口文档](docs/02_ST接口文档.md) | 酒馆助手 API 全签名 |
| [03 MVU 实现文档](docs/03_MVU实现文档.md) | MVU 框架实现：schema / initvar / 正则五件套 |
| [04 状态栏编写文档](docs/04_状态栏编写文档.md) | 状态栏两种写法 |
| [05 角色创建卡片](docs/05_角色创建卡片编写文档.md) | 捏人界面实现 |
| [06 构建工具文档](docs/06_构建工具文档.md) | tavern-cards-forge 命令手册 |
| [07 Electron 工具设计蓝图](docs/07_Electron工具设计蓝图.md) | 端到端实现方案 |

---

## 📄 License

[MIT](LICENSE)
