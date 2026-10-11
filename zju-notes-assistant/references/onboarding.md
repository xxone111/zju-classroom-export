# First-Time Onboarding

Use this when the skill is triggered and neither `~/.zju-notes-assistant/config.json` nor a workspace `zju-notes-assistant.config.json` is found, or when the user asks to initialize/setup the skill.

Default to long-term setup on first use. Guide the user through configuration questions so future exports, course-folder matching, PDF annotation, and chapter-note workflows can run smoothly. Still provide a clear escape hatch for one-off export.

## Opening Message

```text
我可以帮你处理浙大智云课堂回放录音，并做课堂笔记。我可以帮你：

1. 批量导出回放的语音识别原文，并把智云回放中的课件页合成为 PDF。
2. 读取“学在浙大”的课程列表，选择并下载教师上传的原始课程文件。
3. 基于导出的录音原文和课件做进阶笔记工作流，你可以选择以下两种方式：
   - PDF 批注：把老师的详细讲解以 PDF 附注形式写回匹配的课堂课件（暂不支持 PPT 课件），并生成一份课堂重点摘要。
   - 章节笔记文档：根据课件结构把录音整理成章节笔记文档。

首次使用时，我会打开本地助手。你可以在同一个页面完成使用偏好、浙大登录和字幕导出。密码只用于本次登录，不会保存。
```

## Integrated Local UI

Prefer the integrated setup/login/export page over asking configuration questions in chat:

1. Start `node scripts/zju_classroom_auth.js serve` and open the printed localhost URL.
2. The user sets course-note root, note organization, one of the three visual note modes, optional custom reference note, and transcript output folder.
3. Clicking `保存使用偏好` explicitly approves writing `~/.zju-notes-assistant/config.json`.
4. The same page uses one paginated export workspace with separate tabs for transcript export, Smart Classroom slide PDF export, and Learning in ZJU course-file download.
5. Password is never persisted. Auth token/cookies remain in `~/.zju-notes-assistant/auth.json`.
6. Export actions stay inside the active export tab. A separate AI handoff area builds its instruction from the currently selected courses/files.
7. The helper writes `~/.zju-notes-assistant/latest-job.json`; AI continues PDF annotation or chapter notes in chat.

The helper must not ask for the current PDF, match courseware, annotate files, or generate notes. Those remain AI workflows after transcript export.

For returning users, load saved preferences and show whether reusable login state exists. Do not force setup or login again. If the saved session is rejected by the API, ask the user to log in again on the same page.

## Chat Fallback

Only when the integrated local UI cannot start, ask all initialization questions in one compact list:

```text
请一次性回答下面几个问题；不知道的可以写“默认”或“跳过”。

1. 你是否习惯把课程笔记放在一个工作文件夹下？
   如有，请提供文件夹路径；如无，可以写“跳过”。

2. 你主要使用什么笔记软件或文件组织方式？
   可选：Obsidian / 本地文件 / 其他
   默认：本地文件

3. 本地登录助手是否把登录状态保存在默认位置？
   默认位置：~/.zju-notes-assistant/auth.json
   推荐：使用默认。
   说明：这里保存的是用于访问智云课堂的登录状态，不保存你的浙大密码。以后你再次导出课程录音时，通常不需要重复登录。

4. 默认使用哪种笔记方式？
   可选：
   - A：章节笔记（纯文字，按章节和知识点整理）
   - B：课件精注（把课堂讲解写入 PDF 附注；PPT/PPTX 请先转为 PDF）
   - C：自定义模板（请提供参考笔记路径）

5. 字幕输出文件夹是什么？默认：~/Downloads。

6. 是否创建默认配置文件以便之后自动使用？
   可选：是 / 否，先临时使用本次设置。
   推荐：是。
```

## Ask Only What Matters

If the user says they want to skip setup or only export once, ask only:

```text
请提供回放链接/`sub_id`，或者启动本地网页登录助手来登录并选择课程回放。我会先把语音识别原文导出为 Markdown；导出完成后，网页会生成一条可以直接发给 AI 的继续指令。如果之后要 PDF 批注或章节笔记，我再询问需要的 PDF/课程文件夹。
```

For normal first-time setup, ask these setup questions as one list. Parse the user's answers together, then ask follow-up only for missing or ambiguous values.

1. 课程笔记根目录：
   - 询问包含各课程文件夹的根目录，例如 Obsidian vault 里的课程笔记文件夹。
   - 如果用户没有笔记库，就把 `vault_root` 留空，只使用下载目录。
2. 笔记软件/链接风格：
   - 选项：Obsidian / 本地文件 / 其他。
   - 默认使用 `filesystem`。
   - Map Obsidian to `obsidian`, 本地文件 to `filesystem`, 其他 to `filesystem` unless the user gives a specific integration need.
3. auth 文件：
   - 默认 `~/.zju-notes-assistant/auth.json`。
   - 只保存本地 token/cookies，不保存密码。
   - 不要要求用户把密码粘贴到聊天里。
4. 默认笔记方式：
   - A：章节笔记，生成纯文字章节文档。默认推荐。
   - B：课件精注，把详细讲解写入 PDF 附注，并生成课堂重点摘要。
   - C：自定义模板，按 `style_reference_path` 的参考笔记生成。
5. 样式参考笔记：
   - 询问是否有一篇希望模仿的章节笔记路径。
   - 没有就留空，使用所选模板。
6. 是否创建配置文件：
   - 只有用户确认创建时才写入 `~/.zju-notes-assistant/config.json`。

## Setup Questions To Ask The User

Use Chinese user-facing prompts like these:

```text
请一次性回答下面几个问题；不知道的可以写“默认”或“跳过”。

1. 课程笔记根目录是什么？
2. 你主要使用什么笔记软件或文件组织方式？可选：Obsidian / 本地文件 / 其他。默认：本地文件。
3. 本地登录助手是否把登录状态保存在默认位置 ~/.zju-notes-assistant/auth.json？推荐：使用默认。
4. 默认使用哪种笔记方式？可选：A 章节笔记（纯文字） / B 课件精注（PDF 附注） / C 自定义模板。
5. 字幕输出文件夹是什么？默认：~/Downloads。
6. 是否创建默认配置文件以便之后自动使用？可选：是 / 否，先临时使用本次设置。推荐：是。
```

如果用户想做进阶整理，再询问当前回放要走哪条工作流：

- PDF 批注工作流：适合想把讲解直接写入某个 PDF，并生成一份按课堂整理的重点摘要。
- 章节笔记工作流：适合想按章节/小节生成可复习笔记，并在课程主页目录标记 `*with record*`。

## Suggested Config Draft

After collecting setup answers, draft this and ask for confirmation before writing:

```json
{
  "vault_root": "~/Documents/Course Notes",
  "note_app": "filesystem",
  "download_dir": "~/Downloads",
  "auth_file": "~/.zju-notes-assistant/auth.json",
  "replay_source": "local_login_helper",
  "preferred_transcript_format": "md",
  "course_folder_strategy": "match_course_name",
  "default_note_workflow": "chapter_notes",
  "chapter_note_template": "A",
  "style_reference_path": "",
  "trash_policy": "move_to_trash"
}
```

Adjust `vault_root`, `note_app`, `auth_file`, `default_note_workflow`, and `style_reference_path` from the user's answers. Keep `replay_source` as `local_login_helper`, `preferred_transcript_format` as `md`, `download_dir` as `~/Downloads` unless the user gives another path, and `trash_policy` recoverable.

## First-Run UX

Recommended first-run flow:

1. Check for `~/.zju-notes-assistant/config.json`, then a workspace config.
2. If absent, explain the capabilities and open the integrated local UI.
3. Let the user explicitly save preferences, log in, select replays, and export in that UI.
4. If the UI cannot start, use the one-shot chat fallback and ask for confirmation before writing.
5. If the user skips setup, proceed with export to the download directory and avoid course-note/PDF automation until paths are provided.

## Do Not

- Do not hide the one-off export path, but do default to setup for first-time use.
- Do not assume Obsidian. Support plain folders and other Markdown note apps.
- Do not write a config file without explicit user approval.
- Do not include personal paths or course-specific examples in public onboarding.
