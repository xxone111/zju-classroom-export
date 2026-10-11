# Matching Transcripts, Course Folders, and PDFs

Use this workflow before copying transcripts into a note vault, annotating PDFs, generating classroom summaries, or writing chapter notes.

## Inputs

- Prefer exact paths the user provides for transcript, course folder, or PDF.
- Otherwise use `vault_root` and `download_dir` from `zju-classroom-export.config.json`.
- Extract candidate course name, date, section, teacher, and topic words from transcript frontmatter, DOCX text, filename, replay metadata, and the user's request.

## Course Folder Matching

1. If the current job manifest includes `course_folder`, validate it and use it first.
2. If the user provides a course folder path, validate it and use it.
3. Otherwise search direct subfolders of `download_dir`, then `vault_root`.
4. Rank by exact course-name match first.
5. Then use conservative fuzzy matching that ignores spaces, punctuation, dates, section strings, and teacher names.
6. If there is one high-confidence candidate, report the path and use it.
7. If there are multiple plausible candidates or confidence is low, show a short numbered list and ask the user to choose.

## PDF Matching

Do not assume PDFs have frontmatter, Obsidian metadata, or structured links.

1. If the user provides an exact PDF path, validate it and use it.
2. Search the matched course folder first.
3. Rank `.pdf` files by:
   - Filename overlap with course/chapter/topic/date words.
   - Text-layer overlap from the first-pass PDF extraction.
   - Page titles, section headings, and obvious chapter numbers.
   - Directory proximity to the matched course folder.
   - Recency only as a weak tie-breaker.
4. A single high-confidence candidate may be used automatically, but report the path before writing annotations or notes.
5. Ask the user to choose when:
   - Several PDFs are plausible.
   - A replay spans multiple chapters or PDFs.
   - Text extraction does not support the filename guess.
   - The operation will modify the PDF and confidence is not high.

## Confidence Policy

- **High confidence**: exact user path, exact course folder name plus one topic-matching PDF, or strong text/heading overlap with only one candidate.
- **Medium confidence**: plausible filename match but weak text evidence. Ask before modifying files.
- **Low confidence**: no course folder, many similar PDFs, missing transcript metadata, or cross-chapter lecture. Ask.
