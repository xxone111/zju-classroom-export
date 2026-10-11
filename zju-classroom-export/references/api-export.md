# API-First Transcript Export

Use this before any browser fallback when the user wants to export speech-recognition originals. Prefer a provided replay URL/`sub_id`; when the user only gives a course name/date, use the local web login helper to obtain a classroom token and list replay candidates.

This workflow is inspired by the public `zju-learning-assistant` project. Treat its implementation as evidence for available classroom APIs, not as permission to bypass access control.

## Confirmed API Facts

- Replay URLs usually include `sub_id`, e.g. `...#/replay?course_id=82936&sub_id=1939175&tenant_code=112`.
- Classroom course lists can be fetched with Bearer authorization from `classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-day?day=YYYY-MM-DD` or `get-my-course-month?month=YYYY-MM`.
- The speech-recognition/subtitle endpoint is:

```text
https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result?sub_id=SUB_ID&format=json
```

- The subtitle response contains `BeginSec`, `EndSec`, `Text`, and `TransText`. Use `Text` for Chinese original transcript and ignore `TransText` unless the user asks for translation or bilingual output.
- Verified on 2026-09-14: for at least one accessible replay, the subtitle endpoint returned transcript JSON directly with only `sub_id`, without cookie or bearer token. Treat this as an observed behavior, not a guaranteed contract.
- Also verified on 2026-09-14: student-specific list and metadata endpoints still require authentication. Without token, `get-my-course-day` returned `{"code":5002,"msg":"未传入token"}`, and `userapi/v1/infosimple` plus `pptnote/v1/schedule/search-ppt` returned HTTP 403.

## Authentication Policy

- Only export transcripts for replays the user is entitled to access.
- Do not ask the user to paste their ZJU password into chat.
- If login is needed, prefer `scripts/zju_classroom_auth.js serve` and ask the user to open the local `127.0.0.1` page. Password input stays inside the local helper process.
- `scripts/zju_classroom_auth.js login` is available as a terminal fallback, but do not make it the default user experience.
- Do not store passwords. The helper stores only `~/.zju-classroom-export/auth.json` with classroom token, domain/path-scoped cookies, and username for the user's local machine.
- Auth files created by the current helper use `cookie_jar_version: 2`. A legacy auth file may still work for bearer-token transcript access, but Learning in ZJU requires one local re-login so cookies are not sent without domain scoping.
- Try the no-cookie API request first when `sub_id` is known. If it fails with auth/session errors, use the user's normal authenticated browser/session or fall back to the official page export button.
- To list a student's own courses, find replays by date, or search available courseware, expect to need the student's normal authenticated session/token.
- Do not scrape or download content the user cannot access normally.

## Local Login Helper

Use the helper when the user wants a course-name/date workflow such as "拉中级财务会计某节课的字幕" and has not provided a replay URL or `sub_id`.

Recommended web UI:

```bash
node scripts/zju_classroom_auth.js serve
```

Then open the printed local URL, normally:

```text
http://127.0.0.1:8787
```

The page is bound to localhost only. On first use it collects course-note preferences, then lets the user log in, list replay candidates by day/month, select multiple classes, and export transcripts. Returning users keep their saved config and login state.

Local state is kept together under `~/.zju-classroom-export/`:

```text
config.json
auth.json
latest-job.json
job-<timestamp>.json
```

The config contains local paths and note preferences. The auth file contains token/cookies, never the password. Job files connect exported transcripts to later AI workflows.

## Platform Boundary

- The full local helper is a desktop workflow because it runs a local Node process and writes transcripts to filesystem paths AI can read.
- The native path picker supports macOS through JXA/AppleScript standard additions and Windows through Windows PowerShell `-STA` plus `System.Windows.Forms.FolderBrowserDialog` / `OpenFileDialog`.
- In Codex or another sandboxed agent environment on macOS, the helper process needs approved local/unsandboxed execution for `osascript` to connect to the GUI. A sandboxed helper may return `Connection invalid` even when the picker code is valid.
- Windows must run in an interactive desktop user session. If Group Policy disables Windows PowerShell or the process has no desktop access, keep manual path entry available and report the exact error.
- Do not claim Android or iOS support for the full helper. Mobile browsers normally cannot run the local Node service, cannot expose stable absolute filesystem paths, and cannot reach a desktop service bound to that device's `127.0.0.1`.
- Do not bind the helper to `0.0.0.0` merely to make it reachable from a phone; that would expose login and export endpoints to the local network.
- A future mobile edition would need browser-managed file handles or share-sheet downloads and a different AI handoff contract.

Terminal fallback:

```bash
node scripts/zju_classroom_auth.js login
```

The helper follows the same API-level idea as `zju-learning-assistant`:

1. Open ZJUAM CAS login in HTTP.
2. Fetch CAS public key from `https://zjuam.zju.edu.cn/cas/v2/getPubKey`.
3. RSA-encrypt the password locally with no padding, then submit the CAS form.
4. Visit the classroom auth bridge:
   `https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F`
5. Extract `_token` from classroom cookies and save it locally together with cookies scoped by domain, path, expiry, and Secure state.

After login, list replay candidates:

```bash
node scripts/zju_classroom_auth.js list-day 2026-05-12
node scripts/zju_classroom_auth.js list-month 2026-05
```

The list output includes course name, section, teacher, `course_id`, and `sub_id`. Ask the user to choose if multiple candidates match the course name/date. If a single high-confidence candidate matches, report the selected `sub_id` before export.

Read the token directly only when needed:

```bash
node scripts/zju_classroom_auth.js token
```

Pass the saved token to transcript fetching when direct no-auth subtitle access fails:

```bash
node scripts/fetch_transcript_api.js --sub-id SUB_ID --auth-file ~/.zju-classroom-export/auth.json --out transcript.md
```

## Preferred Fast Path

1. Obtain `sub_id`.
   - Parse it from a provided replay URL.
   - Or ask the user to run local login, then list day/month replay candidates and select by course name/date/teacher.
   - Or derive it from another user-provided authenticated API response. Course-list APIs require token/authentication.
2. Try the subtitle API directly without browser cookies.
3. If the response has `code == 0` and `list[0].all_content`, convert it to the requested transcript format.
4. Verify the transcript has enough timestamped Chinese original lines.
5. If the direct API request fails because of auth, CORS, empty response, or changed schema, try authenticated HTTP access if available.
6. If authenticated API access still fails, fall back to official DOCX export.

## Natural-Language Automation After First Login

After the user has logged in once and `auth_file` exists, the skill can handle requests like:

```text
帮我导出这一周的高级财务会计录音文件，并生成课堂笔记。
```

Workflow:

1. Resolve the date range from the user's request, such as this week, last week, or a specific month.
2. Use `scripts/zju_classroom_auth.js list-day` or `list-month` with the saved auth file to get replay candidates.
3. Filter by course name, teacher, date, and section words.
4. If exactly one or a clearly intended set of candidates matches, export transcripts directly.
5. If multiple candidates are plausible, ask the user to choose.
6. Create or read `zju-classroom-export.job.json` containing the exported transcript paths.
7. Continue into the requested downstream workflow:
   - "生成课堂笔记" normally means ask whether they prefer PDF annotation/classroom summary or chapter notes, unless their config has a default.
   - If PDF/course folder matching is ambiguous, ask for a PDF path or course folder.

Do not open Computer Use for this flow.

## Markdown Output

For each subtitle segment:

```markdown
HH:MM:SS 原文
```

Use `BeginSec` for the timestamp. Include frontmatter and title using the same raw transcript Markdown format as `export.md`.

## Failure Modes

- `401/403` or login HTML: direct API access no longer works or this replay requires auth. Try `--auth-file` from the local login helper, then official export if needed.
- `code != 0`: report the code and use official export.
- Empty `all_content`: the replay may not have speech recognition yet. Use official export only if the page shows content; otherwise report no transcript found.
- API schema changed: preserve the raw response for debugging only if it does not expose sensitive tokens or cookies.

## Implementation Notes

- API-first export should not require Computer Use. When no replay URL or `sub_id` was provided, use the local login helper plus day/month course-list APIs.
- Prefer direct HTTP/API for transcript fetching; reserve official page export for explicit browser fallback only.
- For public release, document that this is an unofficial API surface and may change.
