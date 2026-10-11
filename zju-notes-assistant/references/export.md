# Replay Transcript Export

Use this workflow when the user asks to list ZJU replays, choose a replay, export speech recognition originals, or save classroom transcripts.

## Workflow

1. Prefer API-first export when possible. Read `api-export.md`.
   - If the user provides a replay URL, parse `sub_id` directly.
   - If `sub_id` is known, call the subtitle API directly and convert `Text` into the requested transcript format.
   - If the user gives only a course name/date, use `scripts/zju_classroom_auth.js login` locally, then `list-day` or `list-month` to find candidate `sub_id` values.
   - If direct no-auth subtitle access fails, retry with `--auth-file ~/.zju-notes-assistant/auth.json` when local login is available.
   - This avoids slow Computer Use for routine transcript export and replay selection.
2. If multiple authenticated API candidates match, show a short numbered list with course name, teacher, date/section, `course_id`, and `sub_id`; ask the user to choose.
3. If API-first export is unavailable or fails, ask whether the user wants to use the official browser export manually. Do not switch to Computer Use by default.
4. Manual official page export action:
   - On the `classroom.zju.edu.cn/livingroom?...` replay page, click the upper-right `导出课件` control near `收藏` / `点赞` / `扫码观看`.
   - On the dark `interactivemeta.cmc.zju.edu.cn/#/replay?...` replay page, the same export entry may appear as an icon-only control in the upper-right toolbar. There are typically three icons: help/question, export/document, and audio/speaker. Use the middle export/document icon.
   - The export dialog supports multiple choices: `PPT课件`, `语音识别-原文`, and `语音识别-译文`.
   - For original transcripts, select `语音识别-原文`. The confirm button should become `确认导出 (Word)`.
   - Click confirm and verify that a `.docx` downloads.
   - If the page defaults to `PPT课件`, uncheck it before exporting unless the user also wants the slide deck.
5. If the official DOCX export is unavailable, fails, or omits important timestamps/content, use the Markdown fallback only after the user has the replay page open:
   - Generate `scripts/make_bookmarklet.js`.
   - Copy the bookmarklet to the clipboard.
   - Focus the replay tab, press `Cmd+L`, paste, and press `Return`.
   - Verify the downloaded `.md` contains timestamped Chinese original lines.
6. Honor `preferred_transcript_format`:
   - `docx`: keep DOCX only unless the user requests Markdown.
   - `md`: export/convert to Markdown when possible.
   - `both`: keep DOCX and Markdown.
   - `ask`: ask the user which format to keep before conversion or cleanup.
7. When using the local web helper, export a `zju-notes-assistant.job.json` manifest alongside transcripts.
   - Treat the chosen output path as a root and save each transcript under `output_root/课程名/`, shared with that course's exported PDFs and LMS attachments.
   - Include selected transcript paths, course metadata, and `sub_id`.
   - Do not ask for downstream note workflow, course folders, or PDF paths inside the helper page.
   - The helper's responsibility is exporting speech-recognition originals. AI/skill follow-up should ask what to do next.
   - Also write the same manifest to `~/.zju-notes-assistant/latest-job.json`, so later AI requests can automatically find the most recent export.
   - Before export, explain that one replay fits a single-class note, multiple replays from the same course fit a weekly summary, and different courses should normally be exported separately.
   - Show a live selection summary. Warn when the selection contains multiple courses.
   - After a successful export, generate a copyable AI handoff instruction containing the course name and successful replay count. Do not require the user to locate or understand the manifest path.
   - Use `job-manifest.md` to continue into PDF annotation or chapter-note workflows.

The integrated helper also handles first-time preferences, including the user's default note mode. It writes them to `~/.zju-notes-assistant/config.json`; it never stores a ZJU password. Do not ask for the current PDF, match courseware, or execute downstream note workflows inside the helper.

## Local Web Helper Handoff

The helper page should collect:

- First-use note preferences, with defaults and native path pickers.
- Local ZJU login when no reusable auth state exists.
- Selected replay rows.
- Output folder.

After export, tell the user they can continue with:

```text
请使用 zju-notes-assistant 读取最近一次导出的课堂录音（课程名，共 N 节），并按我的默认笔记方式继续处理。
```

The helper should generate this sentence from the successful export results and provide a copy button. When the user sends it, read `~/.zju-notes-assistant/latest-job.json` and follow `job-manifest.md`.

## Markdown Fallback Format

Each Markdown transcript starts with:

```yaml
---
date: YYYY-MM-DD
up:
  - "[[课程名称]]"
in:
---
```

Then include a blank line, an H1 title, and timestamped original transcript lines.

```markdown
# 课程名称 2026-05-12第7-8节 教师

00:04:09 好，同学们下午好，我们
00:04:12 开始上课。
```

## Known Selectors

Observed selectors can change. Treat them as hints, not a contract.

- Replay item row: `.trans-item`
- Timestamp: `.item-title`
- Original Chinese text: `.trans-lan > div:first-child`
- English translation may appear as another child under `.trans-lan`; do not export it when the user asks for 原文.

## Official DOCX Shape

Verified on 2026-06-11 from `classroom.zju.edu.cn/livingroom?...` and `interactivemeta.cmc.zju.edu.cn/#/replay?...`:

- The upper-right `导出课件` dialog can export `语音识别-原文` as Word/DOCX.
- On the dark `interactivemeta` replay page, the export control may be icon-only. It is the middle icon among the upper-right help/export/audio icons, not a text label.
- The downloaded filename may be an opaque generated name such as `20260611163403fo4pgzh3udev.docx`; do not rely on the filename for metadata.
- The document body includes course name, `授课老师：...`, `YYYY-MM-DD第X-Y节`, then a `1. 语音识别` section.
- Transcript lines are timestamped, e.g. `00:04:00：` followed by the recognized original Chinese text.
- Verify DOCX content before renaming, copying, converting, or cleaning up.

Quick local read-only check:

```bash
unzip -p "$docx_file" word/document.xml | perl -0777 -pe 's/<w:tab\/>/ /g; s/<[^>]+>/\n/g; s/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g; s/\n{2,}/\n/g' | sed -n '1,80p'
```

## Naming

- DOCX export: preserve the official filename when useful; rename only with user approval or when organizing a copied file.
- Markdown fallback: `课程名称_YYYY-MM-DD第X-Y节_教师_语音识别原文.md`.
- Local helper path: `导出根目录/课程名称/课程名称_YYYY-MM-DD第X-Y节_教师_语音识别原文.md`.
- If teacher or section cannot be extracted, omit that portion rather than guessing.
- Sanitize `/ \ : * ? " < > |`.
