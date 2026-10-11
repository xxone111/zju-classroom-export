# PDF Integration

This is the workflow presented as **B 课件精注（PDF 附注）** in the integrated setup UI.

Use this workflow when the user asks to annotate a PDF, integrate a transcript and courseware, generate 课堂精注, generate 课堂重点摘要, or automatically make notes on slides.

If the courseware is PPT/PPTX, remind the user to convert it to PDF first. PDF is the stable target for page matching and writable annotations.

## Workflow

1. Locate the transcript and matched PDF using `matching.md`.
2. Extract text from the PDF.
   - Prefer local text-layer extraction with available PDF libraries such as `pypdf`.
   - Do not use whole-PDF vision/OCR by default.
   - If a page has little or no extracted text, mark it low-confidence and use targeted OCR/vision only if the user asks.
3. Clean and segment the transcript.
   - Preserve timestamps when available.
   - Merge raw timestamp lines into coherent teaching segments, usually 2-6 minutes each.
   - Remove filler words and repeated false starts when generating notes.
   - Correct obvious ASR errors only when context makes the correction clear.
4. Align transcript segments to PDF pages.
   - Use page text and transcript similarity first.
   - Apply a lecture-order constraint: pages usually move forward or stay near the previous page.
   - Use section headings and strong terms as anchors.
   - Do not force every segment onto a page.
5. Write detailed PDF annotations directly into the matched PDF when the user requested PDF annotation.
   - Use PDF annotation objects rather than embedding the PDF inside Markdown.
   - Prefer sticky-note/comment annotations when long text would cover slide content.
   - Include the relevant transcript time range when available.
   - Keep annotations useful when reading the courseware alone: more detailed than a title, less raw than a transcript.
6. Generate the classroom summary Markdown note in the same course folder when requested or useful.
7. Verify the PDF contains annotations on intended pages and the summary links to the transcript/PDF when using Obsidian-style notes.

## Alignment Categories

- `PDF annotation`: Content clearly explains or extends a specific PDF page.
- `PDF extension annotation`: Content is not written on the slide but is strongly related to the current page and follows lecture order. Label it as `课堂延伸`.
- `Summary only`: Logistics, homework, group reminders, next-class notices, broad reflections, or content not tied to a page.
- `Unresolved`: Content that cannot be confidently placed. Preserve it under a low-confidence or 待确认 section.

## Annotation Shape

```text
课堂补充 00:57:03-01:11:56

老师这里补充的不只是课件标题，而是解释了这个概念在实际分析中的判断方法：
1. 先说明概念或制度背景。
2. 再写老师给出的例子、反例或业务场景。
3. 最后整理复习时可操作的判断步骤、风险点或常见误区。
```

Avoid one-line annotations such as:

```text
讲了这个概念。
```

## Classroom Summary Format

Name the summary note:

`课程名称_YYYY-MM-DD第X-Y节_课堂重点摘要.md`

```markdown
---
date: YYYY-MM-DD
up:
  - "[[课程名称]]"
courseware: "[[课件PDF文件名.pdf]]"
transcript: "[[语音识别原文文件名]]"
---

# 课程名称 YYYY-MM-DD第X-Y节 课堂重点摘要

## 课堂事项

- 作业、小组、汇报、下节课安排、老师特别提醒等。

## 本节课主线

用一小段话说明这节课从哪里讲到哪里，和课件/上一节课的关系。

## 复习纲要

### 1. 知识点标题

整理老师讲解后的复习内容，包含逻辑、例子、易错点和分析方法。

## PDF 批注未覆盖的内容

- 课外拓展、无法可靠挂页但仍有复习价值的内容。

## 待确认

- 低置信度片段或可能需要人工确认的页码。
```
