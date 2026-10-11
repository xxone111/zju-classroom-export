# Courseware Export

Use the local helper for authenticated courseware export. These are unofficial API surfaces and may change.

## Sources

### Learning in ZJU

- List courses with `POST https://courses.zju.edu.cn/api/my-courses`.
- List academic years with `GET /api/my-academic-years` and semesters with `GET /api/my-semesters`.
- Read teaching-activity uploads from `GET /api/courses/{course_id}/activities`.
- Also inspect paginated `GET /api/courses/{course_id}/homework-activities` for accessible homework attachments.
- Download the original attachment from `GET /api/uploads/reference/{reference_id}/blob`. If unavailable, try the preview blob at `GET /api/uploads/{id}/blob`.

These are original LMS files. Keep `.ppt` and `.pptx` in their original format. Convert them to PDF only when a real local converter is installed and the user chooses conversion.

### Smart Classroom

- Start from a replay row containing `course_id` and `sub_id`.
- Read slide image records from `GET https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id=...&sub_id=...` with pagination.
- Parse each record's JSON `content` and collect `pptimgurl`.
- Download the images the user can access and assemble them in replay order into a PDF.

This PDF is built from replay slide images. Do not describe it as Office PPT/PPTX conversion.

## Authentication And Storage

- One local CAS login initializes both `courses.zju.edu.cn` and Smart Classroom sessions.
- Passwords remain in memory and are never written to disk.
- New auth files use `cookie_jar_version: 2` and store domain/path-scoped cookies. Never send all saved cookies to every ZJU host.
- Legacy auth files may still provide the Smart Classroom bearer token. Require one local re-login before accessing Learning in ZJU so scoped cookies can be created safely.
- Keep the helper bound to `127.0.0.1`.

## Handoff

Treat the selected output directory as an export root. Put every exported transcript, Smart Classroom PDF, and Learning in ZJU attachment under `output_root/课程名/`. Reuse the same sanitized course folder name across all three export types.

After download, write the exported paths to `~/.zju-notes-assistant/latest-job.json` and write a course-specific `zju-notes-assistant.job.json` inside every affected `output_root/课程名/` folder. Set `next_workflow` to `ask`; the web page only exports files, while AI later asks whether to annotate a PDF, create chapter notes, or only archive the files.

In the local UI, keep transcript, Smart Classroom PDF, and Learning in ZJU exports in one tabbed workspace. Paginate course/replay/file tables without losing selections across pages. Keep export buttons in the active export tab; generate the AI handoff text separately from the current selection.

## Safety

- Sanitize course and attachment names before creating paths.
- Use one shared folder per course for transcripts, replay slide PDFs, LMS attachments, manifests, and downstream AI outputs. Avoid overwriting an existing file; add a numeric suffix instead.
- Do not permanently delete downloaded files or temporary artifacts. The integrated implementation assembles slide PDFs in memory and does not need a cleanup deletion step.
- Report per-file failures without discarding successful downloads.
