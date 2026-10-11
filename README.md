# ZJU Classroom Export

面向浙江大学学生的 Agent Skill：通过本地网页登录助手批量导出智云课堂语音识别原文、智云课件 PDF 和“学在浙大”课程附件，并继续生成课件精注或章节笔记。

> 非浙江大学官方项目。请仅访问和下载本人账号正常有权访问的课程内容，并遵守学校平台规则、课程要求和著作权规定。

## 功能

- 在本机网页中登录浙江大学账号，自动读取可访问的课程与回放。
- 按日期筛选并批量导出智云课堂语音识别原文。
- 将智云课堂回放中的课件页导出为 PDF。
- 读取“学在浙大”课程列表，批量下载教师上传的原始附件。
- 按课程统一归档录音、课件、课程附件和后续笔记。
- 支持两类 AI 笔记工作流：
  - **课件精注**：将老师的讲解匹配到 PDF 页面，以附注形式写入，并生成课堂重点摘要。
  - **章节笔记**：根据课件结构，将录音整理为纯文字章节笔记。
- 支持自定义笔记模板和 Obsidian、本地文件等组织方式。

## 输出目录

用户选择的是“导出根目录”，实际文件会按课程名归档：

```text
导出根目录/
└── 课程名称/
    ├── 课程名称_日期节次_教师_语音识别原文.md
    ├── 课程名称_日期节次_课件.pdf
    ├── 学在浙大课程附件
    ├── zju-classroom-export.job.json
    ├── 课程名称_日期节次_课件精注.pdf
    └── 课程名称_日期节次_课堂重点摘要.md
```

## 安装

### 推荐：使用通用 Agent Skills 安装器

如果电脑上已经安装 [Node.js](https://nodejs.org/) 18 或更高版本，可以使用 [Vercel Agent Skills CLI](https://github.com/vercel-labs/skills) 安装：

```bash
npx skills add xxone111/zju-classroom-export
```

安装器会检测本机支持的 AI 助手，并让你选择安装目标和作用范围。它可用于 Claude Code、Codex、Cursor、OpenCode 等支持 Agent Skills 的客户端，不需要手动判断技能目录。

也可以直接指定客户端并安装到用户级目录：

```bash
# Claude Code
npx skills add xxone111/zju-classroom-export --skill zju-classroom-export -g -a claude-code

# Codex
npx skills add xxone111/zju-classroom-export --skill zju-classroom-export -g -a codex

# Cursor
npx skills add xxone111/zju-classroom-export --skill zju-classroom-export -g -a cursor

# OpenCode
npx skills add xxone111/zju-classroom-export --skill zju-classroom-export -g -a opencode
```

检查并更新已安装的 skill：

```bash
npx skills update
```

> `npx skills` 支持的客户端及目录映射会随版本变化，请以安装器当前显示的结果为准。

### 备用：下载或克隆后手动安装

1. 从 [GitHub Releases](https://github.com/xxone111/zju-classroom-export/releases) 下载压缩包，或克隆本仓库。
2. 找到内层包含 `SKILL.md` 的 `zju-classroom-export` 文件夹。
3. 将整个文件夹复制或链接到所用 AI 助手的 skills 目录。
4. 重新启动该 AI 助手，或开始一个新任务。

```bash
git clone https://github.com/xxone111/zju-classroom-export.git
```

常见用户级目录如下，但不同版本可能采用不同位置：

| 客户端 | 常见目录 |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| OpenCode | `~/.config/opencode/skills/` |
| Codex | 建议使用上方安装器自动确定 |

如果你的客户端不支持 Agent Skills 或 `SKILL.md`，仅下载本仓库不会自动获得这些能力。你仍可手动启动本地导出助手，但后续 AI 笔记工作流需要由所用客户端自行读取并执行 `SKILL.md`。

## 首次使用

在支持 Agent Skills 的 AI 助手中输入：

```text
请使用 zju-classroom-export 帮我初始化并打开本地登录助手。
```

AI 助手会启动仅监听 `127.0.0.1` 的本地页面。首次配置包括：

1. 课程笔记根目录，可留空。
2. 笔记组织方式：本地文件、Obsidian 或其他。
3. 默认笔记方式：章节笔记、课件精注或自定义模板。
4. 导出根目录。

登录成功后，可在同一个导出工作区使用三个 Tab：

- `语音识别原文`
- `智云课件 PDF`
- `学在浙大文件`

完成导出后，页面会根据当前选择生成一条可以直接发给 AI 的后续指令。

## 常用指令

```text
帮我导出这一周的中级财务会计课堂录音。
```

```text
请读取最近一次导出的课堂录音，并按我的默认笔记方式继续处理。
```

```text
把这节录音写成课件精注，同时生成课堂重点摘要。
```

```text
根据这两节课的录音和课件生成章节笔记。
```

## 手动启动本地助手

通常由支持本地命令执行的 AI 助手自动启动。需要手动运行时：

```bash
node zju-classroom-export/scripts/zju_classroom_auth.js serve --port 8787
```

然后打开：

```text
http://127.0.0.1:8787/
```

脚本仅使用 Node.js 内置模块，无需运行 `npm install`。建议使用 Node.js 18 或更高版本。

## 配置与本地数据

默认位置：

```text
~/.zju-classroom-export/config.json
~/.zju-classroom-export/auth.json
~/.zju-classroom-export/latest-job.json
```

- `config.json`：导出目录和笔记偏好。
- `auth.json`：登录后产生的本地 token 与按域名、路径隔离的 cookies。
- `latest-job.json`：最近一次导出的文件路径，供 AI 自动继续处理。

密码只在本地登录请求期间存在于内存中，不会写入配置或认证文件。不要把 `auth.json`、课程录音、课件或任务清单提交到 GitHub。

## 平台支持

- macOS：支持原生文件/文件夹选择器。
- Windows：支持 Windows PowerShell + Windows Forms 文件选择器。
- Linux：可以手动填写路径；原生路径选择器暂未实现。
- Android / iOS：当前本地助手定位为桌面工作流，不保证移动端文件系统选择能力。

## 已知限制

- 智云课堂和“学在浙大”使用的是非官方、可能变化的接口，平台更新后可能需要同步适配。
- “学在浙大”中的 PPT/PPTX 会保留原格式，不会伪装成 PDF。
- 课件精注需要 PDF。PPT/PPTX 请先通过可靠工具转换为 PDF。
- 图片型 PDF 没有文字层时，页码匹配需要视觉检查，处理时间会更长。
- 课程回放、字幕和附件是否可用，取决于当前账号本身的访问权限。

## 安全原则

- 本地助手固定绑定 `127.0.0.1`，不向局域网或公网开放。
- 不绕过登录、权限控制、DRM 或安全提示。
- 不永久删除录音、课件和笔记；清理时仅移动到可恢复位置。
- 修改 PDF 或现有笔记前，需要确认课程和课件匹配关系。
- 不把所有 cookies 无差别发送给不同域名。

## 项目结构

```text
zju-classroom-export/
├── SKILL.md
├── agents/
├── assets/
├── references/
└── scripts/
```

`SKILL.md` 是入口，具体导出、匹配、PDF 精注、章节笔记和安全规则按需存放在 `references/` 中。

## 致谢

本项目在探索浙大课程平台登录与资源获取方式时参考了 [PeiPei233/zju-learning-assistant](https://github.com/PeiPei233/zju-learning-assistant) 的公开实现思路。

## License

[MIT](LICENSE)
