# Configuration

Use a user-provided config for public, reusable course-note workflows. Look in this order:

1. A config path explicitly provided by the user.
2. `~/.zju-notes-assistant/config.json`, written by the integrated local setup/login/export UI.
3. A project-specific `zju-notes-assistant.config.json` in the current workspace.

If no config exists, follow `onboarding.md`. Prefer starting the integrated local UI so the user can configure preferences and log in in one place. A simple one-off export must still work without full setup.

## Example

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

## Fields

- `vault_root`: Root folder for course notes. Required for automatic course-folder matching, PDF matching, summaries, and chapter notes.
- `note_app`: Informational value such as `obsidian`, `filesystem`, or another local organization style. Default to `filesystem`; use it to choose link style only when relevant.
- `download_dir`: Export root. Default to `~/Downloads`; actual artifacts are grouped under `download_dir/课程名/`.
- `auth_file`: Local-only auth cache created by `scripts/zju_classroom_auth.js login`. Default `~/.zju-notes-assistant/auth.json`. It may contain classroom token/cookies, but never store a password here.
- `replay_source`: `local_login_helper` by default. Use the local web helper after first login to list and export course replays. `replay_url_or_sub_id` remains available for one-off direct links.
- `preferred_transcript_format`: Default `md`, because the local helper exports Markdown transcripts for downstream notes.
- `course_folder_strategy`: Default `match_course_name`. Match by transcript course name first, then conservative fuzzy folder names.
- `default_note_workflow`: `chapter_notes`, `pdf_annotation`, or `custom`. The UI presents these as A 章节笔记（纯文字）, B 课件精注（PDF 附注）, and C 自定义模板.
- `chapter_note_template`: Legacy-compatible chapter-note style field. Keep `A` for the built-in pure-text chapter workflow; use `custom` when the user chooses C.
- `style_reference_path`: Required for C 自定义模板; points to a user-owned reference note.
- `trash_policy`: Must be `move_to_trash` or another recoverable policy. Do not implement permanent deletion.

## Behavior

- Expand `~` safely before filesystem operations.
- Validate configured paths before using them.
- If `vault_root` is missing or invalid, continue export but ask before any course-note or PDF workflow.
- If `style_reference_path` is missing or invalid, fall back to the user's chosen chapter-note template.
- Treat clicking `保存使用偏好` in the local UI as explicit approval to write `~/.zju-notes-assistant/config.json`.
- Outside that UI, do not write a new config file unless the user explicitly asks.
- Do not write passwords, CAS credentials, or long-lived secrets to config. Auth cache belongs in `auth_file`, with local file permissions restricted when possible.
- On first use, ask only the minimum initialization questions needed for the requested task. Do not block a simple replay export on full note-vault setup.
