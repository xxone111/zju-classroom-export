---
name: zju-notes-assistant
description: Export Zhejiang University Smart Classroom replay transcripts and slide PDFs, download course files from Learning in ZJU, and optionally organize them into a configured course-note vault with PDF annotations, classroom summaries, or chapter notes. Use when the user asks to list ZJU courses/replays, export 导出语音识别/原文/课件, download 学在浙大 course files, match recordings with courseware PDFs, annotate PDFs, or generate classroom/chapter notes.
---

# ZJU Notes Assistant

## Purpose

Use this skill to export Zhejiang University Smart Classroom replay speech-recognition originals, then optionally organize the transcript with the user's course notes and courseware PDFs.

The public version is configurable. Do not assume any personal Obsidian path, course folder layout, PDF metadata, or note style. Prefer `~/.zju-notes-assistant/config.json`; also accept a workspace `zju-notes-assistant.config.json` for project-specific overrides.

## Quick Routing

- **First-time setup**: Read [references/onboarding.md](references/onboarding.md) when no global or workspace config is found, or when the user asks how to initialize the skill.
- **Configuration**: Read [references/config.md](references/config.md) before doing vault or course-note work.
- **Replay export**: Read [references/export.md](references/export.md). Prefer API-first transcript export. Use a provided replay URL/`sub_id`, or use the local web login helper to obtain a short-lived classroom token and list replays. Do not use Computer Use for routine transcript export.
- **API-first transcript export**: Read [references/api-export.md](references/api-export.md) before any browser fallback.
- **Courseware export**: Read [references/courseware-export.md](references/courseware-export.md) before listing Learning in ZJU files or exporting Smart Classroom slides as PDF.
- **Continue exported helper jobs**: Read [references/job-manifest.md](references/job-manifest.md) when `zju-notes-assistant.job.json` exists or the user asks to continue after web-helper export.
- **Transcript/PDF matching**: Read [references/matching.md](references/matching.md). PDF matching never depends on frontmatter.
- **PDF annotation and classroom summary**: Read [references/pdf-integration.md](references/pdf-integration.md).
- **Chapter notes and `with record` updates**: Read [references/chapter-notes.md](references/chapter-notes.md).
- **Deletion, access, and modification safety**: Read [references/safety.md](references/safety.md) before moving, deleting, or modifying user files.

## Core Rules

- Only export replays the user can access after normal login.
- Do not bypass access controls, paywalls, DRM, or browser security interstitials.
- Downloads are allowed.
- If the user has not configured a note vault, export to the browser download directory and ask before copying into course notes.
- Keep the official DOCX when the user wants DOCX, Markdown, or both. Markdown conversion is optional, not mandatory.
- Before modifying a PDF, confirm the matched PDF path unless the user gave the exact path or there is one high-confidence candidate and you clearly report it.
- When updating existing notes, preserve user-authored content. Append or insert lecture-derived material only where clearly appropriate.
- Never permanently delete raw transcripts or generated intermediates. Cleanup must move files to macOS Trash/废纸篓 or another clearly recoverable trash location. If recoverable cleanup fails, leave files in place and report it.
- Do not ask users to paste ZJU passwords into chat. If authenticated course listing is needed, use the local web login helper bound to `127.0.0.1` so password entry stays on the user's machine.
- Treat Learning in ZJU attachments and Smart Classroom slide PDFs as different sources. Preserve LMS `.ppt/.pptx` files as originals unless a real document converter is available; never relabel them as PDF.
- Treat `download_dir` as an export root. Store transcripts, replay slide PDFs, LMS attachments, manifests, and downstream AI outputs together under `download_dir/课程名/`.
- Treat the integrated helper as a desktop-local workflow. Do not claim Android/iOS filesystem-picker support or expose the helper beyond localhost.

## Expected Outputs

- **Replay export**: An official `.docx`, a Markdown transcript, or both, based on user preference/configuration.
- **Courseware export**: Original files from Learning in ZJU, or a PDF assembled from Smart Classroom replay slide images.
- **Helper job handoff**: A `zju-notes-assistant.job.json` manifest that records exported transcripts; the downstream workflow remains `ask` until the user tells AI what to do.
- **User-facing handoff**: The helper shows what kind of replay selection fits the intended note, summarizes the selected classes, and generates a copyable instruction. AI reads `~/.zju-notes-assistant/latest-job.json` automatically; do not ask the user for its path unless it is missing.
- **Course-note organization**: A copied transcript in the matched course folder when configured and confidently matched.
- **PDF integration**: The matched PDF annotated in place, plus a classroom summary Markdown note.
- **Chapter-note workflow**: Chapter Markdown notes with lecture-derived content, course homepage `#Content` entries marked `*with record*`, and non-courseware reminders placed on the course homepage.

## Commands

Generate the Markdown fallback bookmarklet:

```bash
node scripts/make_bookmarklet.js
```

Copy the fallback bookmarklet to the macOS clipboard:

```bash
node scripts/make_bookmarklet.js | pbcopy
```

Start the local web login helper:

```bash
node scripts/zju_classroom_auth.js serve
```

The helper implements native path pickers for macOS and Windows. On macOS, when running through a sandboxed coding agent, start this command with approved local/unsandboxed execution so the picker can connect to the GUI. On Windows, the helper invokes Windows PowerShell in STA mode and uses Windows Forms dialogs. Keep the server bound to `127.0.0.1`; never broaden the bind address to work around picker permissions.

Run local terminal login and save a classroom token as a fallback:

```bash
node scripts/zju_classroom_auth.js login
```

List a day's replay candidates after local login:

```bash
node scripts/zju_classroom_auth.js list-day YYYY-MM-DD
```

List a month's replay candidates after local login:

```bash
node scripts/zju_classroom_auth.js list-month YYYY-MM
```

Fetch transcript by known `sub_id`:

```bash
node scripts/fetch_transcript_api.js --sub-id SUB_ID --out transcript.md
```

Find recent transcript exports in the default download directory:

```bash
find ~/Downloads -maxdepth 1 -type f \( -name '*语音识别原文.md' -o -name '*语音识别原文.docx' \) -print
```
