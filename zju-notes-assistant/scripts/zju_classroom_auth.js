#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { execFile } = require("child_process");
const { Writable } = require("stream");
const {
  CookieJar,
  responseCookies,
  requireScopedCookies,
  getAcademicYears,
  getSemesters,
  getLearningCourses,
  getCourseUploads,
  downloadLearningFile,
  exportReplaySlides,
} = require("./zju_courseware");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:88.0) Gecko/20100101 Firefox/88.0 zju-notes-assistant";
const STATE_DIR = path.join(os.homedir(), ".zju-notes-assistant");
const DEFAULT_AUTH_PATH = path.join(STATE_DIR, "auth.json");
const DEFAULT_CONFIG_PATH = path.join(STATE_DIR, "config.json");
const LATEST_JOB_PATH = path.join(STATE_DIR, "latest-job.json");

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args.shift() : "help";

const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : "";
};

const hasFlag = (name) => args.includes(name);

const authPath = getArg("--auth-file") || DEFAULT_AUTH_PATH;
const configPath = getArg("--config-file") || DEFAULT_CONFIG_PATH;
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), "Downloads");

const usage = () => {
  console.log(`Usage:
  node scripts/zju_classroom_auth.js login [--auth-file path]
  node scripts/zju_classroom_auth.js serve [--port 8787] [--auth-file path] [--config-file path]
  node scripts/zju_classroom_auth.js list-day YYYY-MM-DD [--auth-file path] [--json]
  node scripts/zju_classroom_auth.js list-month YYYY-MM [--auth-file path] [--json]
  node scripts/zju_classroom_auth.js token [--auth-file path]

Notes:
  - In serve mode, the browser page is bound to 127.0.0.1 only.
  - Password input is used only inside this local process.
  - The config file stores note preferences and local paths, never credentials.
  - The auth file stores only classroom token/cookies, never the password.
  - Delete the auth file or run with a different --auth-file when you want to rotate login state.`);
};

const ensureDir = (filePath) => fs.mkdirSync(path.dirname(filePath), { recursive: true });

const defaultConfig = () => ({
  vault_root: "",
  note_app: "filesystem",
  download_dir: DEFAULT_OUTPUT_DIR,
  auth_file: authPath,
  replay_source: "local_login_helper",
  preferred_transcript_format: "md",
  course_folder_strategy: "match_course_name",
  default_note_workflow: "chapter_notes",
  chapter_note_template: "A",
  style_reference_path: "",
  trash_policy: "move_to_trash",
});

const loadConfig = () => {
  if (!fs.existsSync(configPath)) return { exists: false, config: defaultConfig() };
  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const config = { ...defaultConfig(), ...saved };
  if (!saved.default_note_workflow && saved.chapter_note_template === "custom") {
    config.default_note_workflow = "custom";
  }
  return { exists: true, config };
};

const validateOptionalPath = (value, kind, label) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const resolved = expandHome(raw);
  if (!fs.existsSync(resolved)) throw new Error(`${label}不存在：${resolved}`);
  const stat = fs.statSync(resolved);
  if (kind === "folder" && !stat.isDirectory()) throw new Error(`${label}不是文件夹：${resolved}`);
  if (kind === "file" && !stat.isFile()) throw new Error(`${label}不是文件：${resolved}`);
  return raw;
};

const saveConfig = (input) => {
  const noteApp = ["obsidian", "filesystem", "other"].includes(input.note_app) ? input.note_app : "filesystem";
  const workflow = ["chapter_notes", "pdf_annotation", "custom"].includes(input.default_note_workflow)
    ? input.default_note_workflow
    : "chapter_notes";
  const config = {
    ...defaultConfig(),
    vault_root: validateOptionalPath(input.vault_root, "folder", "课程笔记根目录"),
    note_app: noteApp,
    download_dir: validateOptionalPath(input.download_dir, "folder", "字幕输出文件夹") || DEFAULT_OUTPUT_DIR,
    default_note_workflow: workflow,
    chapter_note_template: workflow === "custom" ? "custom" : "A",
    style_reference_path: validateOptionalPath(input.style_reference_path, "file", "自定义模板参考文件"),
  };
  if (workflow === "custom" && !config.style_reference_path) {
    throw new Error("选择自定义模板后，请选择一份参考笔记文件。");
  }
  ensureDir(configPath);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
};

const request = async (jar, url, options = {}) => {
  let current = url;
  let method = options.method || "GET";
  let body = options.body;
  for (let redirects = 0; redirects < 10; redirects += 1) {
    const headers = {
      "User-Agent": USER_AGENT,
      Accept: options.accept || "*/*",
      ...(options.headers || {}),
    };
    const cookie = jar.header(current);
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(current, {
      method,
      headers,
      body,
      redirect: "manual",
    });
    jar.addFromResponse(res.headers, current);
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    current = new URL(location, current).toString();
    if (res.status === 303 || method === "POST") {
      method = "GET";
      body = undefined;
    }
  }
  throw new Error("Too many redirects during login.");
};

const readHidden = (query) =>
  new Promise((resolve) => {
    const mutedOutput = new Writable({
      write(chunk, encoding, callback) {
        if (!mutedOutput.muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    mutedOutput.muted = false;
    const rl = readline.createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
    rl.question(query, (value) => {
      mutedOutput.muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(value);
    });
    mutedOutput.muted = true;
  });

const ask = (query) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (value) => {
      rl.close();
      resolve(value.trim());
    });
  });

const modPow = (base, exponent, modulus) => {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
};

const rsaNoPadding = (plain, modulusHex, exponentHex) => {
  const bytes = Buffer.from(plain, "utf8");
  const input = BigInt(`0x${bytes.toString("hex")}`);
  const modulus = BigInt(`0x${modulusHex}`);
  const exponent = BigInt(`0x${exponentHex}`);
  let hex = modPow(input, exponent, modulus).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return hex;
};

const extractExecution = (html) => {
  const match = html.match(/<input[^>]+name=["']execution["'][^>]+value=["']([^"']+)["']/);
  if (!match) throw new Error("Cannot find CAS execution field. The login page may have changed.");
  return match[1];
};

const extractToken = (jar) => {
  const decoded = decodeURIComponent(jar.header("https://classroom.zju.edu.cn/"));
  const match = decoded.match(/\{i:\d+;s:\d+:"_token";i:\d+;s:\d+:"(.+?)";\}/);
  if (!match) throw new Error("Cannot find classroom _token in cookies after login.");
  return match[1];
};

const performLogin = async (username, password) => {
  if (!username || !password) throw new Error("Username and password are required.");

  const jar = new CookieJar();
  const loginPage = await request(jar, "https://zjuam.zju.edu.cn/cas/login");
  const loginHtml = await loginPage.text();
  if (!loginHtml.includes("统一身份认证平台")) {
    throw new Error("CAS login page was not returned. Check network or ZJUAM availability.");
  }
  const execution = extractExecution(loginHtml);

  const pubKeyRes = await request(jar, "https://zjuam.zju.edu.cn/cas/v2/getPubKey", {
    accept: "application/json",
  });
  const pubKey = await pubKeyRes.json();
  if (!pubKey.modulus || !pubKey.exponent) throw new Error("CAS public key response is missing fields.");

  const form = new URLSearchParams({
    username,
    password: rsaNoPadding(password, pubKey.modulus, pubKey.exponent),
    execution,
    _eventId: "submit",
    authcode: "",
  });
  const casRes = await request(jar, "https://zjuam.zju.edu.cn/cas/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const casText = await casRes.text();
  if (casText.includes("统一身份认证平台")) {
    throw new Error("CAS login failed. Check username, password, or required second-factor steps.");
  }

  await request(jar, "https://courses.zju.edu.cn/user/courses");
  await request(
    jar,
    "https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F"
  );
  await request(
    jar,
    "https://zjuam.zju.edu.cn/cas/login?service=https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html",
    { method: "POST" }
  );

  const token = extractToken(jar);
  const auth = {
    created_at: new Date().toISOString(),
    username,
    token,
    cookie_jar_version: 2,
    cookies: jar.toJSON(),
  };
  ensureDir(authPath);
  fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  return auth;
};

const login = async () => {
  const username = getArg("--username") || (await ask("ZJU account: "));
  const password = getArg("--password") || (await readHidden("ZJU password: "));
  await performLogin(username, password);
  console.log(`Saved classroom auth to ${authPath}`);
  console.log("Password was not saved.");
};

const loadAuth = () => {
  if (!fs.existsSync(authPath)) throw new Error(`Auth file not found: ${authPath}. Run login first.`);
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  if (!auth.token) throw new Error(`Auth file has no token: ${authPath}`);
  return auth;
};

const saveAuth = (auth) => {
  ensureDir(authPath);
  fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
};

const authorizedJson = async (url) => {
  const auth = loadAuth();
  const jar = new CookieJar(responseCookies(auth));
  const res = await request(jar, url, {
    accept: "application/json",
    headers: { Authorization: auth.token.startsWith("Bearer ") ? auth.token : `Bearer ${auth.token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (auth.cookie_jar_version === 2) {
    auth.cookies = jar.toJSON();
    saveAuth(auth);
  }
  return JSON.parse(text);
};

const normalizeCourses = (json) => {
  const rows = [];
  const pushCourse = (course, dateHint = "") => {
    rows.push({
      date: dateHint || course.date || course.day || "",
      course_id: course.id || course.course_id || "",
      sub_id: course.sub_id || "",
      course_name: course.title || course.course_name || "",
      section: course.sub_title || course.section || "",
      teacher: course.realname || course.teacher || "",
    });
  };
  if (Array.isArray(json.list)) {
    for (const day of json.list) {
      const dateHint = day.day || day.date || "";
      for (const course of day.course || []) pushCourse(course, dateHint);
    }
  } else if (json.list && typeof json.list === "object") {
    for (const [dateHint, item] of Object.entries(json.list)) {
      for (const course of item.course || []) pushCourse(course, dateHint);
    }
  }
  return rows;
};

const pad = (n) => String(n).padStart(2, "0");

const hhmmss = (seconds) => {
  const value = Number(seconds || 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const expandHome = (value) => {
  const input = String(value || "").trim();
  if (!input) return DEFAULT_OUTPUT_DIR;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
};

const sanitizeFilenamePart = (value, fallback = "未命名") => {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
};

const uniqueFilePath = (target) => {
  if (!fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`无法为文件生成不重复名称：${target}`);
};

const transcriptMarkdown = (row, items) => {
  const date = String(row.date || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().slice(0, 10);
  const course = sanitizeFilenamePart(row.course_name, "课程");
  const title = [row.course_name, row.section, row.teacher].filter(Boolean).join(" ");
  const lines = items
    .map((item) => {
      const text = String(item.Text || "").replace(/\s+/g, " ").trim();
      return text ? `${hhmmss(item.BeginSec)} ${text}` : "";
    })
    .filter(Boolean);
  return [
    "---",
    `date: ${date}`,
    "up:",
    `  - "[[${course.replace(/"/g, '\\"')}]]"`,
    "in:",
    "---",
    "",
    `# ${title || course}`,
    "",
    ...lines,
    "",
  ].join("\n");
};

const fetchTranscriptRows = async (subId) => {
  const url = `https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result?sub_id=${encodeURIComponent(subId)}&format=json`;
  let json;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = JSON.parse(text);
  } catch (err) {
    json = await authorizedJson(url);
  }
  if (json.code !== 0) throw new Error(`字幕接口返回 code=${json.code}`);
  const rows = json.list?.[0]?.all_content || [];
  if (!rows.length) throw new Error("字幕接口没有返回语音识别内容。");
  return rows;
};

const buildTranscriptFiles = async (rows) => {
  const results = [];
  for (const row of rows) {
    if (!row.sub_id) {
      results.push({ ok: false, row, error: "缺少 sub_id" });
      continue;
    }
    try {
      const items = await fetchTranscriptRows(row.sub_id);
      const filename = [
        row.date,
        row.course_name,
        row.section,
        row.teacher,
        "语音识别原文",
      ]
        .filter(Boolean)
        .map((part) => sanitizeFilenamePart(part))
        .join("_");
      results.push({
        ok: true,
        row,
        filename: `${filename || row.sub_id}.md`,
        content: transcriptMarkdown(row, items),
        lines: items.length,
      });
    } catch (err) {
      results.push({ ok: false, row, error: err.message });
    }
  }
  return results;
};

const exportTranscripts = async (rows, outputDir) => {
  const dir = expandHome(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const results = await buildTranscriptFiles(rows);
  for (const item of results) {
    if (!item.ok) continue;
    const courseDir = path.join(dir, sanitizeFilenamePart(item.row.course_name, "课程"));
    fs.mkdirSync(courseDir, { recursive: true });
    const filePath = uniqueFilePath(path.join(courseDir, item.filename));
    fs.writeFileSync(filePath, item.content);
    item.file = filePath;
    item.course_folder = courseDir;
    delete item.content;
  }
  return { output_dir: dir, results };
};

const loadLearningCatalog = async () => {
  const auth = loadAuth();
  requireScopedCookies(auth);
  const academicYears = await getAcademicYears(request, auth);
  const semesters = await getSemesters(request, auth);
  const courses = await getLearningCourses(request, auth);
  saveAuth(auth);
  return { academic_years: academicYears, semesters, courses };
};

const loadLearningFiles = async (courses) => {
  const auth = loadAuth();
  requireScopedCookies(auth);
  const files = [];
  for (const course of courses) {
    files.push(...(await getCourseUploads(request, auth, course, true)));
  }
  saveAuth(auth);
  return files;
};

const exportLearningFiles = async (uploads, outputDir) => {
  const auth = loadAuth();
  requireScopedCookies(auth);
  const dir = expandHome(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const upload of uploads) {
    try {
      const downloaded = await downloadLearningFile(request, auth, upload, dir);
      results.push({ ok: true, upload, ...downloaded });
    } catch (err) {
      results.push({ ok: false, upload, error: err.message });
    }
  }
  saveAuth(auth);
  return { output_dir: dir, results };
};

const exportSlidePdfs = async (rows, outputDir) => {
  const auth = loadAuth();
  const dir = expandHome(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const row of rows) {
    try {
      if (!row.course_id || !row.sub_id) throw new Error("回放缺少 course_id 或 sub_id。");
      const exported = await exportReplaySlides(request, auth, row, dir);
      results.push({ ok: true, row, ...exported });
    } catch (err) {
      results.push({ ok: false, row, error: err.message });
    }
  }
  if (auth.cookie_jar_version === 2) saveAuth(auth);
  return { output_dir: dir, results };
};

const runPickerProcess = (file, pickerArgs, timeout = 120000) =>
  new Promise((resolve, reject) => {
    execFile(file, pickerArgs, { timeout }, (err, stdout, stderr) => {
      if (!err) {
        resolve(String(stdout || "").trim());
        return;
      }
      const message = String(stderr || err.message || "").trim();
      if (/User canceled|用户已取消|-128/i.test(message)) {
        resolve("");
        return;
      }
      reject(new Error(message || "选择器打开失败。"));
    });
  });

const chooseWithMacDialog = async ({ kind, prompt }) => {
  if (process.platform !== "darwin") {
    throw new Error("当前系统暂不支持原生选择器，请直接填写路径。");
  }

  const title = String(prompt || (kind === "file" ? "选择文件" : "选择文件夹"));
  const chooseFile = kind === "file";
  const picker = chooseFile ? "chooseFile" : "chooseFolder";
  const jxaSource = [
    "const app = Application.currentApplication();",
    "app.includeStandardAdditions = true;",
    `const picked = app.${picker}({withPrompt: ${JSON.stringify(title)}});`,
    "picked.toString();",
  ].join("\n");
  try {
    return await runPickerProcess("/usr/bin/osascript", ["-l", "JavaScript", "-e", jxaSource]);
  } catch (jxaError) {
    const appleScriptPicker = chooseFile ? "choose file" : "choose folder";
    const appleScript = `POSIX path of (${appleScriptPicker} with prompt ${JSON.stringify(title)})`;
    try {
      return await runPickerProcess("/usr/bin/osascript", ["-e", appleScript]);
    } catch (appleScriptError) {
      throw new Error(`系统选择器打开失败。JXA: ${jxaError.message}; AppleScript: ${appleScriptError.message}`);
    }
  }
};

const powerShellString = (value) => `'${String(value || "").replace(/'/g, "''")}'`;

const chooseWithWindowsDialog = async ({ kind, prompt }) => {
  const title = String(prompt || (kind === "file" ? "选择文件" : "选择文件夹"));
  const chooseFile = kind === "file";
  const dialogSetup = chooseFile
    ? [
        "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
        `$dialog.Title = ${powerShellString(title)}`,
        "$dialog.CheckFileExists = $true",
        "$dialog.Multiselect = $false",
        "$dialog.Filter = 'All files (*.*)|*.*'",
      ]
    : [
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        `$dialog.Description = ${powerShellString(title)}`,
        "$dialog.ShowNewFolderButton = $true",
      ];
  const selectedProperty = chooseFile ? "$dialog.FileName" : "$dialog.SelectedPath";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "[System.Windows.Forms.Application]::EnableVisualStyles()",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
    ...dialogSetup,
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    `  [Console]::Out.Write(${selectedProperty})`,
    "}",
    "$dialog.Dispose()",
  ].join("\r\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const windowsPowerShell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const executable = fs.existsSync(windowsPowerShell) ? windowsPowerShell : "powershell.exe";
  return runPickerProcess(executable, ["-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", encoded]);
};

const chooseWithNativeDialog = async (options) => {
  if (process.platform === "darwin") return chooseWithMacDialog(options);
  if (process.platform === "win32") return chooseWithWindowsDialog(options);
  throw new Error("当前系统暂不支持原生选择器，请直接填写路径。");
};

const buildJobManifest = ({ results, outputDir, outputMode }) => {
  const createdAt = new Date().toISOString();
  return {
    schema: "zju-notes-assistant.job.v1",
    created_at: createdAt,
    output_mode: outputMode || "local_path",
    output_dir: outputDir || "",
    next_workflow: "ask",
    notes: "此清单只记录已导出的语音识别原文。后续由 AI 根据用户请求继续处理。",
    items: results
      .filter((item) => item.ok)
      .map((item) => ({
        course_name: item.row.course_name || "",
        teacher: item.row.teacher || "",
        date: item.row.date || "",
        section: item.row.section || "",
        course_id: item.row.course_id || "",
        sub_id: item.row.sub_id || "",
        transcript_md: item.file || item.filename || "",
        transcript_filename: item.filename || (item.file ? path.basename(item.file) : ""),
        transcript_lines: item.lines || 0,
        course_folder: item.course_folder || (item.file ? path.dirname(item.file) : ""),
        next_workflow: "ask",
      })),
  };
};

const buildCoursewareJobManifest = ({ results, outputDir, source }) => ({
  schema: "zju-notes-assistant.job.v1",
  created_at: new Date().toISOString(),
  output_mode: "local_path",
  output_dir: outputDir || "",
  next_workflow: "ask",
  notes: "此清单记录本次导出的课程文件。后续由 AI 根据用户请求匹配录音、PDF 或生成笔记。",
  items: results
    .filter((item) => item.ok)
    .map((item) => ({
      source,
      course_name: item.row?.course_name || item.upload?.course_name || "",
      date: item.row?.date || "",
      section: item.row?.section || "",
      course_id: item.row?.course_id || item.upload?.course_id || "",
      sub_id: item.row?.sub_id || "",
      courseware_file: item.file || "",
      pages: item.pages || 0,
      course_folder: item.file ? path.dirname(item.file) : "",
      next_workflow: "ask",
    })),
});

const writeJobCopies = (job, outputDir) => {
  const manifestText = `${JSON.stringify(job, null, 2)}\n`;
  const grouped = new Map();
  for (const item of job.items || []) {
    const itemFile = item.transcript_md || item.courseware_file || "";
    const courseDir = item.course_folder || (path.isAbsolute(itemFile) ? path.dirname(itemFile) : "") || outputDir;
    if (!grouped.has(courseDir)) grouped.set(courseDir, []);
    grouped.get(courseDir).push(item);
  }
  if (!grouped.size) grouped.set(outputDir, []);

  const outputJobFiles = [];
  for (const [courseDir, items] of grouped.entries()) {
    fs.mkdirSync(courseDir, { recursive: true });
    const courseJob = { ...job, output_dir: courseDir, items };
    const outputJobFile = path.join(courseDir, "zju-notes-assistant.job.json");
    fs.writeFileSync(outputJobFile, `${JSON.stringify(courseJob, null, 2)}\n`);
    outputJobFiles.push(outputJobFile);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LATEST_JOB_PATH, manifestText);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const historyPath = path.join(STATE_DIR, `job-${stamp}.json`);
  fs.writeFileSync(historyPath, manifestText);

  return {
    outputJobFile: outputJobFiles[0],
    outputJobFiles,
    latestJobFile: LATEST_JOB_PATH,
    historyJobFile: historyPath,
  };
};

const printCourses = (rows) => {
  if (hasFlag("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("No classroom replays found.");
    return;
  }
  rows.forEach((row, index) => {
    console.log(
      `${index + 1}. ${row.date} ${row.course_name} ${row.section} ${row.teacher} sub_id=${row.sub_id} course_id=${row.course_id}`
    );
  });
};

const listDay = async (day) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("list-day expects YYYY-MM-DD.");
  const json = await authorizedJson(
    `https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-day?day=${encodeURIComponent(day)}`
  );
  printCourses(normalizeCourses(json));
};

const listMonth = async (month) => {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("list-month expects YYYY-MM.");
  const json = await authorizedJson(
    `https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-month?month=${encodeURIComponent(month)}`
  );
  printCourses(normalizeCourses(json));
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const pageHtml = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZJU Notes Assistant</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f8fa; color: #1f2933; }
    header { background: #fff; border-bottom: 1px solid #dfe4ea; }
    header > div, main { max-width: 1040px; margin: 0 auto; padding-left: 20px; padding-right: 20px; }
    header > div { padding-top: 28px; padding-bottom: 24px; }
    main { padding-top: 8px; padding-bottom: 48px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 0 0 16px; }
    p { line-height: 1.55; color: #52616f; }
    section { padding: 24px 0; border-bottom: 1px solid #dfe4ea; }
    label { display: block; font-weight: 650; margin: 14px 0 6px; }
    input, select { width: 100%; box-sizing: border-box; height: 40px; border: 1px solid #ccd4dd; border-radius: 6px; padding: 0 10px; font-size: 15px; }
    button { height: 40px; border: 0; border-radius: 6px; padding: 0 14px; background: #1769aa; color: white; font-weight: 650; cursor: pointer; }
    button.secondary { background: #34495e; }
    button.quiet { background: #e9eef3; color: #263746; }
    button:disabled { opacity: .55; cursor: progress; }
    .row { display: grid; grid-template-columns: 1fr 150px; gap: 10px; align-items: end; }
    .wideRow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: end; }
    .pathRow { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
    fieldset { border: 0; padding: 0; margin: 20px 0 0; }
    legend { font-weight: 650; margin-bottom: 8px; }
    .templateGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .templateCard { display: grid; grid-template-columns: 20px 1fr; gap: 10px; margin: 0; padding: 12px; border: 1px solid #ccd4dd; border-radius: 8px; background: #fff; cursor: pointer; }
    .templateCard:has(input:checked) { border-color: #1769aa; box-shadow: inset 0 0 0 1px #1769aa; }
    .templateCard input[type="radio"] { width: 18px; height: 18px; margin: 2px 0 0; padding: 0; }
    .templateName { display: block; margin-bottom: 8px; }
    .templateName small { display: block; margin-top: 3px; color: #66788a; font-weight: 400; }
    .templatePreview, .previewHeading, .previewSubheading, .previewLine { display: block; }
    .templatePreview { height: 112px; box-sizing: border-box; border: 1px solid #d8dee6; border-radius: 4px; background: #f9fafb; padding: 10px; overflow: hidden; }
    .previewHeading { width: 55%; height: 8px; background: #263746; margin-bottom: 12px; }
    .previewSubheading { width: 38%; height: 6px; background: #6c7d8b; margin: 11px 0 7px; }
    .previewLine { height: 4px; background: #c7d0d9; margin: 6px 0; }
    .previewLine.short { width: 70%; }
    .pdfPreview { display: grid; grid-template-columns: 1fr 34%; gap: 8px; }
    .pdfPage { background: #fff; border: 1px solid #d8dee6; padding: 7px; }
    .pdfNote { background: #fff3cd; border-left: 3px solid #d29b19; padding: 6px; }
    .customPreview { display: grid; place-items: center; border-style: dashed; color: #52616f; font-size: 26px; font-weight: 700; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .statusDock { position: sticky; top: 8px; z-index: 20; margin: 8px 0 0; padding: 10px 12px; background: rgba(255,255,255,.96); border: 1px solid #ccd4dd; border-radius: 6px; box-shadow: 0 4px 14px rgba(31,41,51,.12); backdrop-filter: blur(8px); }
    .statusDock strong { display: block; margin-bottom: 4px; font-size: 13px; color: #263746; }
    .status { white-space: pre-wrap; max-height: 92px; overflow: auto; color: #52616f; font-size: 13px; line-height: 1.45; }
    .hint { font-size: 13px; color: #66788a; margin-top: 8px; }
    .bridge { margin-top: 18px; padding: 14px 16px; border-left: 3px solid #1769aa; background: #eef5fa; }
    .bridge h3 { font-size: 15px; margin: 0 0 6px; }
    .bridge p { margin: 5px 0; font-size: 14px; }
    .selectionSummary { color: #263746; font-weight: 650; }
    .handoff { margin-top: 18px; padding-top: 18px; border-top: 1px solid #dfe4ea; }
    .handoff h3 { font-size: 16px; margin: 0 0 6px; }
    textarea { width: 100%; min-height: 82px; box-sizing: border-box; resize: vertical; border: 1px solid #ccd4dd; border-radius: 6px; padding: 10px; font: inherit; line-height: 1.5; }
    .sectionHead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .state { font-size: 13px; font-weight: 650; color: #1769aa; }
    .hidden { display: none; }
    .tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid #ccd4dd; margin: 4px 0 18px; }
    .tabButton { flex: 0 0 auto; border-radius: 0; background: transparent; color: #52616f; border-bottom: 3px solid transparent; }
    .tabButton[aria-selected="true"] { color: #1769aa; border-bottom-color: #1769aa; }
    .tableWrap { overflow-x: auto; }
    .pagination { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 12px; }
    .pagination button { width: 36px; min-width: 36px; padding: 0; background: #e9eef3; color: #263746; }
    .pagination button.current { background: #1769aa; color: #fff; }
    .paginationInfo { margin-right: auto; color: #66788a; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th, td { border-bottom: 1px solid #e5e9ef; padding: 9px 6px; text-align: left; vertical-align: top; }
    th { color: #52616f; font-weight: 650; }
    code { background: #eef2f6; padding: 2px 5px; border-radius: 4px; }
    .selectCell { width: 34px; }
    input[type="checkbox"] { width: 18px; height: 18px; }
    @media (max-width: 720px) { .row, .wideRow, .pathRow, .templateGrid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<header>
  <div>
    <h1>ZJU Notes Assistant</h1>
    <p>登录浙大账号后，可以导出智云课堂语音原文、智云课件 PDF，以及学在浙大的课程文件。PDF 批注和章节笔记在导出后由 AI 继续处理。</p>
  </div>
</header>
<main>
  <div class="statusDock" role="status" aria-live="polite">
    <strong>当前状态</strong>
    <div class="status" id="status">等待操作。</div>
  </div>
  <section id="setupSection">
    <div class="sectionHead"><h2>1. 使用偏好</h2><span class="state" id="configState">正在读取...</span></div>
    <div class="pathRow">
      <div>
        <label for="vaultRoot">课程笔记根目录（可选）</label>
        <input id="vaultRoot" placeholder="没有统一的课程笔记文件夹可以留空">
      </div>
      <button class="quiet" id="chooseVaultBtn" type="button">选择文件夹</button>
    </div>
    <label for="noteApp">笔记组织方式</label>
    <select id="noteApp">
      <option value="filesystem">本地文件</option>
      <option value="obsidian">Obsidian</option>
      <option value="other">其他</option>
    </select>
    <fieldset>
      <legend>默认笔记方式</legend>
      <div class="templateGrid">
        <label class="templateCard">
          <input type="radio" name="defaultWorkflow" value="chapter_notes" checked>
          <span>
            <span class="templateName">A 章节笔记<small>纯文字，按章节和知识点整理</small></span>
            <span class="templatePreview">
              <span class="previewHeading"></span><span class="previewSubheading"></span>
              <span class="previewLine"></span><span class="previewLine"></span><span class="previewLine short"></span>
              <span class="previewSubheading"></span><span class="previewLine"></span>
            </span>
          </span>
        </label>
        <label class="templateCard">
          <input type="radio" name="defaultWorkflow" value="pdf_annotation">
          <span>
            <span class="templateName">B 课件精注<small>把课堂讲解写入 PDF 附注</small></span>
            <span class="templatePreview pdfPreview">
              <span class="pdfPage"><span class="previewHeading"></span><span class="previewLine"></span><span class="previewLine"></span><span class="previewLine short"></span></span>
              <span class="pdfNote"><span class="previewLine"></span><span class="previewLine"></span><span class="previewLine short"></span></span>
            </span>
          </span>
        </label>
        <label class="templateCard">
          <input type="radio" name="defaultWorkflow" value="custom">
          <span>
            <span class="templateName">C 自定义模板<small>参考你已有的笔记样式</small></span>
            <span class="templatePreview customPreview">Aa</span>
          </span>
        </label>
      </div>
      <div class="hint hidden" id="pdfReminder">课件精注目前只支持 PDF；如果课件是 PPT/PPTX，请先转换为 PDF。</div>
    </fieldset>
    <div class="pathRow hidden" id="styleReferenceRow">
      <div>
        <label for="styleReference">自定义模板参考笔记</label>
        <input id="styleReference" placeholder="选择一份你满意的笔记文件">
      </div>
      <button class="quiet" id="chooseStyleBtn" type="button">选择文件</button>
    </div>
    <div class="pathRow">
      <div>
        <label for="outputDir">导出文件夹</label>
        <input id="outputDir" value="${escapeHtml(DEFAULT_OUTPUT_DIR)}">
      </div>
      <button class="quiet" id="chooseOutputDirBtn" type="button">选择文件夹</button>
    </div>
    <div class="hint">实际文件会按课程归档到“导出文件夹/课程名/”，录音原文、课件和课程附件共用同一课程文件夹。</div>
    <div class="actions"><button id="saveConfigBtn">保存使用偏好</button></div>
    <div class="hint">配置保存在本机，不包含浙大账号或密码。</div>
  </section>

  <section id="loginSection">
    <div class="sectionHead"><h2>2. 登录浙大账号</h2><span class="state" id="authState">正在读取...</span></div>
    <p class="hint">一次登录同时授权智云课堂和学在浙大。页面只运行在本机 127.0.0.1；密码只用于本次登录，不会保存。</p>
    <label for="username">浙大账号</label>
    <input id="username" autocomplete="username">
    <label for="password">密码</label>
    <input id="password" type="password" autocomplete="current-password">
    <div class="actions">
      <button id="loginBtn">登录</button>
    </div>
  </section>

  <section id="exportWorkspace">
    <h2>3. 选择并导出课程文件</h2>
    <div class="tabs" role="tablist" aria-label="导出类型">
      <button class="tabButton" role="tab" aria-selected="true" data-export-tab="transcript">语音识别原文</button>
      <button class="tabButton" role="tab" aria-selected="false" data-export-tab="slides">智云课件 PDF</button>
      <button class="tabButton" role="tab" aria-selected="false" data-export-tab="learning">学在浙大文件</button>
    </div>

    <div id="replayPanel">
      <div class="row">
        <div>
          <label for="dateValue">日期</label>
          <input id="dateValue" type="date">
        </div>
        <div>
          <label for="mode">范围</label>
          <select id="mode"><option value="day">按天</option><option value="month">按月</option></select>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" id="listBtn">列出回放</button>
        <button class="quiet" id="selectAllBtn" type="button">全选</button>
        <button class="quiet" id="clearSelectionBtn" type="button">清空选择</button>
      </div>
      <div id="results"></div>
      <p class="selectionSummary" id="selectionSummary">尚未选择课堂。</p>
      <div class="actions">
        <button id="exportBtn">导出所选原文</button>
        <button id="exportSlidesBtn" class="hidden">导出所选课件 PDF</button>
      </div>
    </div>

    <div id="learningPanel" class="hidden">
      <p class="hint">下载教师上传的原始附件。PDF 原样保存；PPT/PPTX 保留原格式。</p>
      <div class="wideRow">
        <div><label for="academicYear">学年</label><select id="academicYear"><option value="">全部学年</option></select></div>
        <div><label for="semester">学期</label><select id="semester"><option value="">全部学期</option></select></div>
      </div>
      <div class="actions">
        <button class="secondary" id="loadLearningBtn">读取课程列表</button>
        <button class="quiet" id="selectAllCoursesBtn" type="button">全选课程</button>
        <button class="quiet" id="clearCoursesBtn" type="button">清空课程</button>
      </div>
      <div id="learningCourses"></div>
      <div class="actions"><button class="secondary" id="loadFilesBtn">读取所选课程文件</button></div>
      <div id="learningFiles"></div>
      <div class="actions">
        <button class="quiet" id="selectAllFilesBtn" type="button">全选文件</button>
        <button class="quiet" id="clearFilesBtn" type="button">清空文件</button>
        <button id="downloadFilesBtn">下载所选文件</button>
      </div>
    </div>
  </section>

  <section>
    <h2>4. 回到 AI 继续处理</h2>
    <p class="hint">指令会按照当前 Tab 和已勾选的课程实时生成。完成导出后，复制并发送给 AI。</p>
    <div class="handoff" id="handoffPanel">
      <textarea id="handoffPrompt" readonly>请先选择要导出的课程。</textarea>
      <div class="actions"><button class="quiet" id="copyHandoffBtn" type="button">复制给 AI 的指令</button></div>
    </div>
  </section>
</main>
<script>
const statusBox = document.querySelector("#status");
const results = document.querySelector("#results");
const learningCoursesBox = document.querySelector("#learningCourses");
const learningFilesBox = document.querySelector("#learningFiles");
let currentRows = [];
let learningCourses = [];
let learningFiles = [];
let currentPlatform = "";
let activeExportTab = "transcript";
let replayPage = 1;
let coursePage = 1;
let filePage = 1;
const PAGE_SIZE = 10;
const replaySelected = new Set();
const courseSelected = new Set();
const fileSelected = new Set();
const setStatus = (text) => { statusBox.textContent = text; };
const getJson = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "请求失败");
  return json;
};
const postJson = async (url, data) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "请求失败");
  return json;
};
const paginationHtml = (page, total, pageSize) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  let buttons = "<button class='pageButton' data-page='" + Math.max(1, page - 1) + "' aria-label='上一页'" + (page <= 1 ? " disabled" : "") + ">‹</button>";
  for (let value = start; value <= end; value += 1) {
    buttons += "<button class='pageButton" + (value === page ? " current" : "") + "' data-page='" + value + "'>" + value + "</button>";
  }
  buttons += "<button class='pageButton' data-page='" + Math.min(pageCount, page + 1) + "' aria-label='下一页'" + (page >= pageCount ? " disabled" : "") + ">›</button>";
  return "<div class='pagination'><span class='paginationInfo'>共 " + total + " 条，第 " + page + " / " + pageCount + " 页</span>" + buttons + "</div>";
};
const bindPagination = (box, setPage, render) => {
  box.querySelectorAll(".pageButton").forEach((button) => button.addEventListener("click", () => {
    setPage(Number(button.dataset.page));
    render();
  }));
};
const selectedReplayRows = () => [...replaySelected].sort((a, b) => a - b).map((index) => currentRows[index]).filter(Boolean);
const selectedLearningCourses = () => [...courseSelected].sort((a, b) => a - b).map((index) => learningCourses[index]).filter(Boolean);
const selectedLearningFiles = () => [...fileSelected].sort((a, b) => a - b).map((index) => learningFiles[index]).filter(Boolean);
const renderReplayRows = () => {
  if (!currentRows.length) {
    results.innerHTML = "";
    updateSelectionSummary();
    return;
  }
  const pageCount = Math.max(1, Math.ceil(currentRows.length / PAGE_SIZE));
  replayPage = Math.min(replayPage, pageCount);
  const start = (replayPage - 1) * PAGE_SIZE;
  const visible = currentRows.slice(start, start + PAGE_SIZE);
  results.innerHTML = "<div class='tableWrap'><table><thead><tr><th class='selectCell'></th><th>#</th><th>日期</th><th>课程</th><th>节次</th><th>教师</th><th>sub_id</th></tr></thead><tbody>" +
    visible.map((row, offset) => {
      const index = start + offset;
      return "<tr><td class='selectCell'><input class='rowSelect' type='checkbox' data-index='" + index + "'" + (replaySelected.has(index) ? " checked" : "") + "></td><td>" + (index + 1) + "</td><td>" + escapeHtml(row.date) + "</td><td>" + escapeHtml(row.course_name) + "</td><td>" + escapeHtml(row.section) + "</td><td>" + escapeHtml(row.teacher) + "</td><td><code>" + escapeHtml(row.sub_id) + "</code></td></tr>";
    }).join("") + "</tbody></table></div>" + paginationHtml(replayPage, currentRows.length, PAGE_SIZE);
  results.querySelectorAll(".rowSelect").forEach((box) => box.addEventListener("change", () => {
    const index = Number(box.dataset.index);
    if (box.checked) replaySelected.add(index); else replaySelected.delete(index);
    updateSelectionSummary();
  }));
  bindPagination(results, (page) => { replayPage = page; }, renderReplayRows);
  updateSelectionSummary();
};
const filteredLearningCourses = () => {
  const year = document.querySelector("#academicYear").value;
  const semester = document.querySelector("#semester").value;
  return learningCourses
    .map((course, index) => ({ course, index }))
    .filter(({ course }) => (!year || String(course.academic_year_id) === year) && (!semester || String(course.semester_id) === semester));
};
const renderLearningCourses = () => {
  const filtered = filteredLearningCourses();
  if (!filtered.length) {
    learningCoursesBox.innerHTML = "<p>当前筛选下没有课程。</p>";
    updateHandoffPrompt();
    return;
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  coursePage = Math.min(coursePage, pageCount);
  const start = (coursePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  learningCoursesBox.innerHTML = "<div class='tableWrap'><table><thead><tr><th class='selectCell'></th><th>课程</th><th>课程代码</th><th>教师</th></tr></thead><tbody>" +
    visible.map(({ course, index }) => "<tr><td class='selectCell'><input class='courseSelect' type='checkbox' data-index='" + index + "'" + (courseSelected.has(index) ? " checked" : "") + "></td><td>" + escapeHtml(course.name) + "</td><td>" + escapeHtml(course.course_code || "") + "</td><td>" + escapeHtml((course.instructors || []).map((item) => item.name).join("、")) + "</td></tr>").join("") +
    "</tbody></table></div>" + paginationHtml(coursePage, filtered.length, PAGE_SIZE);
  learningCoursesBox.querySelectorAll(".courseSelect").forEach((box) => box.addEventListener("change", () => {
    const index = Number(box.dataset.index);
    if (box.checked) courseSelected.add(index); else courseSelected.delete(index);
    updateHandoffPrompt();
  }));
  bindPagination(learningCoursesBox, (page) => { coursePage = page; }, renderLearningCourses);
  updateHandoffPrompt();
};
const renderLearningFiles = () => {
  if (!learningFiles.length) {
    learningFilesBox.innerHTML = "<p>没有找到课程文件。</p>";
    updateHandoffPrompt();
    return;
  }
  const pageCount = Math.max(1, Math.ceil(learningFiles.length / PAGE_SIZE));
  filePage = Math.min(filePage, pageCount);
  const start = (filePage - 1) * PAGE_SIZE;
  const visible = learningFiles.slice(start, start + PAGE_SIZE);
  learningFilesBox.innerHTML = "<div class='tableWrap'><table><thead><tr><th class='selectCell'></th><th>课程</th><th>文件名</th><th>来源</th><th>大小</th></tr></thead><tbody>" +
    visible.map((file, offset) => {
      const index = start + offset;
      return "<tr><td class='selectCell'><input class='uploadSelect' type='checkbox' data-index='" + index + "'" + (fileSelected.has(index) ? " checked" : "") + "></td><td>" + escapeHtml(file.course_name) + "</td><td>" + escapeHtml(file.name) + "</td><td>" + escapeHtml(file.source) + "</td><td>" + escapeHtml(file.size ? (file.size / 1024 / 1024).toFixed(1) + " MB" : "未知") + "</td></tr>";
    }).join("") + "</tbody></table></div>" + paginationHtml(filePage, learningFiles.length, PAGE_SIZE);
  learningFilesBox.querySelectorAll(".uploadSelect").forEach((box) => box.addEventListener("change", () => {
    const index = Number(box.dataset.index);
    if (box.checked) fileSelected.add(index); else fileSelected.delete(index);
    updateHandoffPrompt();
  }));
  bindPagination(learningFilesBox, (page) => { filePage = page; }, renderLearningFiles);
  updateHandoffPrompt();
};
const updateHandoffPrompt = () => {
  const prompt = document.querySelector("#handoffPrompt");
  if (activeExportTab === "learning") {
    const selectedFiles = selectedLearningFiles();
    const selectedCourses = selectedFiles.length ? selectedFiles : selectedLearningCourses();
    const names = [...new Set(selectedCourses.map((item) => item.course_name || item.name).filter(Boolean))];
    if (!names.length) {
      prompt.value = "请先选择要导出的学在浙大课程或文件。";
      return;
    }
    const countText = selectedFiles.length ? "，共 " + selectedFiles.length + " 个文件" : "";
    prompt.value = "请使用 zju-notes-assistant 读取最近一次导出的课程文件（" + names.join("、") + countText + "），并按我的默认笔记方式继续处理。";
    return;
  }
  const selected = selectedReplayRows();
  const names = [...new Set(selected.map((row) => row.course_name).filter(Boolean))];
  if (!selected.length) {
    prompt.value = "请先选择要导出的智云课堂回放。";
    return;
  }
  const kind = activeExportTab === "slides" ? "智云课件 PDF" : "课堂录音";
  prompt.value = "请使用 zju-notes-assistant 读取最近一次导出的" + kind + "（" + (names.join("、") || "所选课程") + "，共 " + selected.length + " 节），并按我的默认笔记方式继续处理。";
};
const updateSelectionSummary = () => {
  const selected = selectedReplayRows();
  const summary = document.querySelector("#selectionSummary");
  const exportBtn = document.querySelector("#exportBtn");
  if (!selected.length) {
    summary.textContent = "尚未选择课堂。";
    exportBtn.textContent = "导出所选原文";
    document.querySelector("#exportSlidesBtn").textContent = "导出所选课件 PDF";
    updateHandoffPrompt();
    return;
  }
  const courses = [...new Set(selected.map((row) => row.course_name).filter(Boolean))];
  const courseNames = courses.length ? "：" + courses.join("、") : "。";
  const splitHint = courses.length > 1 ? " 当前包含多门课程，建议分批导出，后续生成笔记会更准确。" : "";
  summary.textContent = "已选择 " + selected.length + " 节" + courseNames + splitHint;
  exportBtn.textContent = "导出 " + selected.length + " 节原文";
  document.querySelector("#exportSlidesBtn").textContent = "导出 " + selected.length + " 份课件 PDF";
  updateHandoffPrompt();
};
const selectedWorkflow = () => document.querySelector('input[name="defaultWorkflow"]:checked')?.value || "chapter_notes";
const updateTemplateVisibility = () => {
  const workflow = selectedWorkflow();
  document.querySelector("#styleReferenceRow").classList.toggle("hidden", workflow !== "custom");
  document.querySelector("#pdfReminder").classList.toggle("hidden", workflow !== "pdf_annotation");
};
const loadState = async () => {
  try {
    const json = await getJson("/api/state");
    currentPlatform = json.platform || "";
    const config = json.config;
    document.querySelector("#vaultRoot").value = config.vault_root || "";
    document.querySelector("#noteApp").value = config.note_app || "filesystem";
    const workflow = config.default_note_workflow || (config.chapter_note_template === "custom" ? "custom" : "chapter_notes");
    const workflowInput = document.querySelector('input[name="defaultWorkflow"][value="' + workflow + '"]');
    if (workflowInput) workflowInput.checked = true;
    document.querySelector("#styleReference").value = config.style_reference_path || "";
    document.querySelector("#outputDir").value = config.download_dir || "${escapeHtml(DEFAULT_OUTPUT_DIR)}";
    document.querySelector("#configState").textContent = json.config_exists ? "已配置" : "首次设置";
    document.querySelector("#authState").textContent = json.learning_auth_ready
      ? "智云与学在浙大已就绪"
      : json.auth_exists
        ? "需重新登录以启用学在浙大"
        : "尚未登录";
    updateTemplateVisibility();
    setStatus(json.config_exists ? "设置已载入，可以登录或直接查找回放。" : "请先完成使用偏好，然后登录智云课堂。 ");
  } catch (err) {
    setStatus("读取本地状态失败：\\n" + err.message);
  }
};
document.querySelectorAll('input[name="defaultWorkflow"]').forEach((input) => input.addEventListener("change", updateTemplateVisibility));
const setExportTab = (tab) => {
  activeExportTab = tab;
  document.querySelectorAll(".tabButton").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.exportTab === tab));
  });
  document.querySelector("#replayPanel").classList.toggle("hidden", tab === "learning");
  document.querySelector("#learningPanel").classList.toggle("hidden", tab !== "learning");
  document.querySelector("#exportBtn").classList.toggle("hidden", tab !== "transcript");
  document.querySelector("#exportSlidesBtn").classList.toggle("hidden", tab !== "slides");
  updateHandoffPrompt();
};
document.querySelectorAll(".tabButton").forEach((button) => button.addEventListener("click", () => setExportTab(button.dataset.exportTab)));
document.querySelector("#saveConfigBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    const json = await postJson("/api/config", {
      vault_root: document.querySelector("#vaultRoot").value,
      note_app: document.querySelector("#noteApp").value,
      download_dir: document.querySelector("#outputDir").value,
      default_note_workflow: selectedWorkflow(),
      style_reference_path: document.querySelector("#styleReference").value
    });
    document.querySelector("#configState").textContent = "已配置";
    setStatus("使用偏好已保存：\\n" + json.config_file);
  } catch (err) {
    setStatus("保存失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#loginBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    setStatus("正在登录，请稍等...");
    const json = await postJson("/api/login", {
      username: document.querySelector("#username").value,
      password: document.querySelector("#password").value
    });
    document.querySelector("#password").value = "";
    document.querySelector("#authState").textContent = "智云与学在浙大已就绪";
    setStatus("登录成功，授权文件已保存：\\n" + json.auth_file);
  } catch (err) {
    setStatus("登录失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#listBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    setStatus("正在读取回放列表...");
    const mode = document.querySelector("#mode").value;
    const value = document.querySelector("#dateValue").value.trim();
    const json = await postJson("/api/list", { mode, value });
    currentRows = json.rows;
    replaySelected.clear();
    replayPage = 1;
    renderReplayRows();
    if (!json.rows.length) results.innerHTML = "<p>没有找到回放。</p>";
    setStatus("读取完成。请勾选课堂，然后在当前 Tab 中导出。");
  } catch (err) {
    setStatus("读取失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#loadLearningBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    setStatus("正在读取学在浙大的课程列表...");
    const json = await getJson("/api/learning/catalog");
    learningCourses = json.courses || [];
    courseSelected.clear();
    coursePage = 1;
    const years = [...(json.academic_years || [])].sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0));
    const semesters = [...(json.semesters || [])].sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0));
    document.querySelector("#academicYear").innerHTML = "<option value=''>全部学年</option>" + years.map((item) => "<option value='" + escapeHtml(item.id) + "'>" + escapeHtml(item.name) + "</option>").join("");
    document.querySelector("#semester").innerHTML = "<option value=''>全部学期</option>" + semesters.map((item) => "<option value='" + escapeHtml(item.id) + "' data-year='" + escapeHtml(item.academic_year_id) + "'>" + escapeHtml(item.name) + "</option>").join("");
    renderLearningCourses();
    setStatus("课程列表读取完成，共 " + learningCourses.length + " 门。请选择课程后读取文件。");
  } catch (err) {
    setStatus("读取课程失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#academicYear").addEventListener("change", () => {
  const selectedYear = document.querySelector("#academicYear").value;
  const semester = document.querySelector("#semester");
  [...semester.options].forEach((option) => {
    option.hidden = Boolean(selectedYear && option.value && option.dataset.year !== selectedYear);
  });
  if (semester.selectedOptions[0]?.hidden) semester.value = "";
  coursePage = 1;
  renderLearningCourses();
});
document.querySelector("#semester").addEventListener("change", () => { coursePage = 1; renderLearningCourses(); });
document.querySelector("#selectAllCoursesBtn").addEventListener("click", () => {
  filteredLearningCourses().forEach(({ index }) => courseSelected.add(index));
  renderLearningCourses();
});
document.querySelector("#clearCoursesBtn").addEventListener("click", () => {
  courseSelected.clear();
  renderLearningCourses();
});
document.querySelector("#loadFilesBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  const courses = selectedLearningCourses();
  if (!courses.length) {
    setStatus("请先选择至少一门课程。");
    return;
  }
  btn.disabled = true;
  try {
    setStatus("正在读取 " + courses.length + " 门课程的文件...");
    const json = await postJson("/api/learning/files", { courses });
    learningFiles = json.files || [];
    fileSelected.clear();
    filePage = 1;
    renderLearningFiles();
    setStatus("文件列表读取完成，共 " + learningFiles.length + " 个文件。包括教学活动和可访问的作业附件。");
  } catch (err) {
    setStatus("读取课程文件失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#selectAllFilesBtn").addEventListener("click", () => {
  learningFiles.forEach((_, index) => fileSelected.add(index));
  renderLearningFiles();
});
document.querySelector("#clearFilesBtn").addEventListener("click", () => {
  fileSelected.clear();
  renderLearningFiles();
});
document.querySelector("#downloadFilesBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  const uploads = selectedLearningFiles();
  if (!uploads.length) {
    setStatus("请先选择至少一个课程文件。");
    return;
  }
  btn.disabled = true;
  try {
    setStatus("正在下载 " + uploads.length + " 个课程文件...");
    const json = await postJson("/api/learning/download", {
      uploads,
      output_dir: document.querySelector("#outputDir").value
    });
    const ok = json.results.filter((item) => item.ok);
    const failed = json.results.filter((item) => !item.ok);
    setStatus("课程文件下载完成。\\n输出文件夹：" + json.output_dir + "\\n成功：" + ok.length + "，失败：" + failed.length + "\\n" +
      json.results.map((item) => item.ok ? "✓ " + item.file : "✗ " + (item.upload.name || "文件") + "：" + item.error).join("\\n"));
  } catch (err) {
    setStatus("下载失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#mode").addEventListener("change", (event) => {
  const input = document.querySelector("#dateValue");
  if (event.target.value === "month") {
    input.type = "month";
    input.previousElementSibling.textContent = "月份";
  } else {
    input.type = "date";
    input.previousElementSibling.textContent = "日期";
  }
});
document.querySelector("#selectAllBtn").addEventListener("click", () => {
  currentRows.forEach((_, index) => replaySelected.add(index));
  renderReplayRows();
});
document.querySelector("#clearSelectionBtn").addEventListener("click", () => {
  replaySelected.clear();
  renderReplayRows();
});
const choosePath = async (button, target, kind, prompt) => {
  button.disabled = true;
  const foregroundHint = currentPlatform === "darwin"
    ? "如果窗口没有出现在前台，请查看 Dock。"
    : currentPlatform === "win32"
      ? "如果窗口没有出现在前台，请查看任务栏。"
      : "如果系统不支持原生选择器，请直接填写路径。";
  setStatus("正在打开系统选择器...\\n" + foregroundHint);
  try {
    const json = await postJson("/api/choose-path", { kind, prompt });
    if (json.path) {
      document.querySelector(target).value = json.path;
      setStatus("已选择：" + json.path);
    } else {
      setStatus("已取消选择。");
    }
  } catch (err) {
    setStatus("选择失败：\\n" + err.message + "\\n也可以直接在输入框里填写路径。");
  } finally {
    button.disabled = false;
  }
};
document.querySelector("#chooseOutputDirBtn").addEventListener("click", (event) => choosePath(event.currentTarget, "#outputDir", "folder", "选择字幕输出文件夹"));
document.querySelector("#chooseVaultBtn").addEventListener("click", (event) => choosePath(event.currentTarget, "#vaultRoot", "folder", "选择课程笔记根目录"));
document.querySelector("#chooseStyleBtn").addEventListener("click", (event) => choosePath(event.currentTarget, "#styleReference", "file", "选择自定义模板参考笔记"));
document.querySelector("#copyHandoffBtn").addEventListener("click", async () => {
  const prompt = document.querySelector("#handoffPrompt");
  try {
    await navigator.clipboard.writeText(prompt.value);
    setStatus("已复制给 AI 的指令。回到 AI 后直接粘贴发送即可。");
  } catch (err) {
    prompt.focus();
    prompt.select();
    const copied = document.execCommand("copy");
    setStatus(copied ? "已复制给 AI 的指令。" : "自动复制失败，已选中指令文字，请手动复制。");
  }
});
document.querySelector("#exportSlidesBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  const selected = selectedReplayRows();
  if (!selected.length) {
    setStatus("请先勾选至少一节智云课堂回放。");
    return;
  }
  btn.disabled = true;
  try {
    setStatus("正在下载课件页并合成 " + selected.length + " 份 PDF，请稍等...");
    const json = await postJson("/api/classroom/export-slides", {
      rows: selected,
      output_dir: document.querySelector("#outputDir").value
    });
    const ok = json.results.filter((item) => item.ok);
    const failed = json.results.filter((item) => !item.ok);
    setStatus("智云课件导出完成。\\n输出文件夹：" + json.output_dir + "\\n成功：" + ok.length + "，失败：" + failed.length + "\\n" +
      json.results.map((item) => item.ok ? "✓ " + item.file + "（" + item.pages + " 页）" : "✗ " + (item.row.course_name || item.row.sub_id) + "：" + item.error).join("\\n"));
  } catch (err) {
    setStatus("课件 PDF 导出失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#exportBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  const selected = selectedReplayRows();
  if (!selected.length) {
    setStatus("请先勾选至少一节课。");
    return;
  }
  btn.disabled = true;
  try {
    setStatus("正在导出 " + selected.length + " 节课的字幕...");
    const json = await postJson("/api/export", {
      rows: selected,
      output_dir: document.querySelector("#outputDir").value,
      format: "md",
      output_mode: "local_path"
    });
    const ok = json.results.filter((item) => item.ok);
    const failed = json.results.filter((item) => !item.ok);
    setStatus("导出完成。\\n输出文件夹：" + json.output_dir + "\\n成功：" + ok.length + "，失败：" + failed.length + "\\n" +
      (ok.length ? "下一步：复制下方 AI 指令并发送。\\n" : "") +
      json.results.map((item) => item.ok ? "✓ " + item.file + " (" + item.lines + " 行)" : "✗ " + (item.row.course_name || item.row.sub_id) + "：" + item.error).join("\\n"));
  } catch (err) {
    setStatus("导出失败：\\n" + err.message);
  } finally {
    btn.disabled = false;
  }
});
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
setExportTab("transcript");
loadState();
</script>
</body>
</html>`;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
};

const serve = async () => {
  const http = require("http");
  const port = Number(getArg("--port") || 8787);
  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || "");
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        sendJson(res, 403, { error: "This local helper only accepts localhost requests." });
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(pageHtml());
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        const loaded = loadConfig();
        const authExists = fs.existsSync(authPath);
        let learningAuthReady = false;
        if (authExists) {
          try {
            const savedAuth = JSON.parse(fs.readFileSync(authPath, "utf8"));
            learningAuthReady = savedAuth.cookie_jar_version === 2 && Array.isArray(savedAuth.cookies);
          } catch {
            learningAuthReady = false;
          }
        }
        sendJson(res, 200, {
          ok: true,
          config_exists: loaded.exists,
          auth_exists: authExists,
          learning_auth_ready: learningAuthReady,
          platform: process.platform,
          native_picker_supported: process.platform === "darwin" || process.platform === "win32",
          config_file: configPath,
          auth_file: authPath,
          config: loaded.config,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/config") {
        const body = JSON.parse(await readBody(req));
        const config = saveConfig(body);
        sendJson(res, 200, { ok: true, config_file: configPath, config });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/login") {
        const body = JSON.parse(await readBody(req));
        await performLogin(String(body.username || ""), String(body.password || ""));
        sendJson(res, 200, { ok: true, auth_file: authPath });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/list") {
        const body = JSON.parse(await readBody(req));
        const value = String(body.value || "").trim();
        const mode = body.mode === "month" ? "month" : "day";
        if (mode === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期格式应为 YYYY-MM-DD。");
        if (mode === "month" && !/^\d{4}-\d{2}$/.test(value)) throw new Error("月份格式应为 YYYY-MM。");
        const apiUrl =
          mode === "day"
            ? `https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-day?day=${encodeURIComponent(value)}`
            : `https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-month?month=${encodeURIComponent(value)}`;
        const json = await authorizedJson(apiUrl);
        sendJson(res, 200, { ok: true, rows: normalizeCourses(json) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/learning/catalog") {
        const catalog = await loadLearningCatalog();
        sendJson(res, 200, { ok: true, ...catalog });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/learning/files") {
        const body = JSON.parse(await readBody(req));
        const courses = Array.isArray(body.courses) ? body.courses : [];
        if (!courses.length) throw new Error("没有选择课程。");
        if (courses.length > 100) throw new Error("一次最多读取 100 门课程。");
        const files = await loadLearningFiles(courses);
        sendJson(res, 200, { ok: true, files });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/learning/download") {
        const body = JSON.parse(await readBody(req));
        const uploads = Array.isArray(body.uploads) ? body.uploads : [];
        if (!uploads.length) throw new Error("没有选择课程文件。");
        if (uploads.length > 500) throw new Error("一次最多下载 500 个文件。");
        const result = await exportLearningFiles(uploads, body.output_dir);
        const job = buildCoursewareJobManifest({
          results: result.results,
          outputDir: result.output_dir,
          source: "learning_in_zju",
        });
        const jobFiles = writeJobCopies(job, result.output_dir);
        sendJson(res, 200, { ok: true, ...result, ...jobFiles, job });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/classroom/export-slides") {
        const body = JSON.parse(await readBody(req));
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (!rows.length) throw new Error("没有选择课堂回放。");
        if (rows.length > 50) throw new Error("一次最多导出 50 节课件。");
        const result = await exportSlidePdfs(rows, body.output_dir);
        const job = buildCoursewareJobManifest({
          results: result.results,
          outputDir: result.output_dir,
          source: "classroom_slide_pdf",
        });
        const jobFiles = writeJobCopies(job, result.output_dir);
        sendJson(res, 200, { ok: true, ...result, ...jobFiles, job });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/choose-path") {
        const body = JSON.parse(await readBody(req));
        const kind = body.kind === "file" ? "file" : "folder";
        const selectedPath = await chooseWithNativeDialog({
          kind,
          prompt: String(body.prompt || (kind === "file" ? "选择文件" : "选择文件夹")),
        });
        sendJson(res, 200, { ok: true, path: selectedPath });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/export") {
        const body = JSON.parse(await readBody(req));
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (!rows.length) throw new Error("没有选择要导出的课程。");
        const result = await exportTranscripts(rows, body.output_dir);
        const job = buildJobManifest({
          results: result.results,
          outputDir: result.output_dir,
          outputMode: body.output_mode || "local_path",
        });
        const jobFiles = writeJobCopies(job, result.output_dir);
        sendJson(res, 200, {
          ok: true,
          ...result,
          job_file: jobFiles.outputJobFile,
          job_files: jobFiles.outputJobFiles,
          latest_job_file: jobFiles.latestJobFile,
          history_job_file: jobFiles.historyJobFile,
          job,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/render-transcripts") {
        const body = JSON.parse(await readBody(req));
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (!rows.length) throw new Error("没有选择要导出的课程。");
        const results = await buildTranscriptFiles(rows);
        const jobResults = results.map((item) => {
          if (!item.ok) return item;
          return { ...item, content: undefined };
        });
        const job = buildJobManifest({
          results: jobResults,
          outputDir: body.output_dir || "",
          outputMode: body.output_mode || "browser_directory",
        });
        sendJson(res, 200, { ok: true, results, job });
        return;
      }
      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`ZJU Notes Assistant login helper: http://127.0.0.1:${port}`);
    console.log(`Config file: ${configPath}`);
    console.log(`Auth file: ${authPath}`);
  });
};

(async () => {
  if (command === "login") await login();
  else if (command === "serve") await serve();
  else if (command === "list-day") await listDay(args[0]);
  else if (command === "list-month") await listMonth(args[0]);
  else if (command === "token") console.log(loadAuth().token);
  else usage();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
