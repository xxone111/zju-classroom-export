# Chapter Notes

Use this workflow when the user asks to generate notes by course chapter, fill lecture recordings into the PDF/courseware structure, create `with record` chapter notes, or update the course `#Content` table of contents.

Use the built-in pure-text chapter structure for workflow A. When workflow C is configured, use `style_reference_path` as the style reference instead.

## Workflow

1. Locate the transcript, course folder, and matching PDF(s) using `matching.md`.
2. Generate an internal detailed classroom recording summary from the transcript.
   - Do not save a per-class classroom summary unless the user asks.
   - Use this summary as the intermediate source for chapter notes.
3. Extract only the PDF courseware structure.
   - Capture page numbers, section titles, subsection titles, and obvious page titles.
   - Do not create or keep a separate courseware outline file unless the user asks.
   - Do not fill the outline with generic courseware explanations; the value comes from lecture-derived content.
4. Split lecture content across the courseware structure.
   - Put lecture content under the matching chapter/section/page heading.
   - If a replay spans multiple chapters or PDFs, split content into each relevant chapter note.
   - If a destination note exists, update it conservatively and preserve existing content.
   - If no note exists, create it using the chapter title from the courseware.
5. Put non-courseware content on the course homepage, not inside chapter notes.
   - Homework, group work, logistics, attendance, broad career advice, and reminders belong on the course homepage unless they directly explain the chapter.
6. Update the course homepage `#Content`.
   - Add newly created chapter notes.
   - Mark notes containing lecture recording content with `*with record*`.
   - If the entry already exists, add the marker rather than duplicating the entry.
7. After verification, clean up raw transcripts only through a recoverable trash action.

## Built-In Chapter Note: Courseware Structure + Recording Supplement

Default recommended template.

```markdown
---
date: 2026-05-12
up:
  - "[[课程名称]]"
record_dates:
  - 2026-05-12第7-8节
---

# C2.1 章节标题

## 课件结构

### p.5 第一节标题

### p.6-p.8 核心概念

---

## 课堂录音补充

### p.5 第一节标题

这里整理老师对本页的解释，保留推理、例子、易错点和课堂提醒。

> 老师强调的一句话结论。

1. **关键概念**
   - 课堂解释。
   - 典型例子。

2. **分析方法**
   - 如何判断。
   - 和其他概念的区别。
```

## Style Rules

- Notes should read like polished study notes, not raw transcripts.
- Preserve lecture-specific examples, cases, numbers, thresholds, warnings, and reasoning chains.
- Use page or page-range headings when the note is courseware-aligned.
- Use block quotes sparingly for central teacher takeaways.
- Use tables for comparisons when they reduce ambiguity.
- Embed PDF pages only when they are especially useful; do not embed every page by default.
