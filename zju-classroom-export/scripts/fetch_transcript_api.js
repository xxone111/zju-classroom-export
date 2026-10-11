#!/usr/bin/env node

const fs = require("fs");

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : "";
};

const subId = getArg("--sub-id");
const out = getArg("--out") || "";
const course = getArg("--course") || "课程";
const section = getArg("--section") || "";
const teacher = getArg("--teacher") || "";
const cookie = getArg("--cookie") || process.env.ZJU_CLASSROOM_COOKIE || "";
const authFile = getArg("--auth-file") || process.env.ZJU_CLASSROOM_AUTH_FILE || "";
let authorization = getArg("--authorization") || process.env.ZJU_CLASSROOM_AUTHORIZATION || "";
const format = getArg("--format") || "md";

if (!subId) {
  console.error("Usage: node scripts/fetch_transcript_api.js --sub-id SUB_ID [--out file.md] [--course 课程名] [--section 日期节次] [--teacher 教师]");
  process.exit(2);
}

const pad = (n) => String(n).padStart(2, "0");
const hhmmss = (seconds) => {
  const value = Number(seconds || 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const dateFromSection = (section.match(/\d{4}-\d{2}-\d{2}/) || [new Date().toISOString().slice(0, 10)])[0];
const title = [course, section, teacher].filter(Boolean).join(" ");

const headers = {
  "User-Agent": "Mozilla/5.0 zju-classroom-export",
  "Accept": "application/json",
};
if (!authorization && authFile) {
  const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
  authorization = auth.token || "";
}
if (cookie) headers.Cookie = cookie;
if (authorization) headers.Authorization = authorization.startsWith("Bearer ") ? authorization : `Bearer ${authorization}`;

const url = `https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result?sub_id=${encodeURIComponent(subId)}&format=json`;

(async () => {
  const res = await fetch(url, { headers });
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Transcript API failed: HTTP ${res.status}`);
  }
  if (!contentType.includes("json") && /^\s*</.test(text)) {
    throw new Error("Transcript API returned HTML; authenticated session may be missing.");
  }

  const json = JSON.parse(text);
  if (json.code !== 0) {
    throw new Error(`Transcript API returned code ${json.code}`);
  }
  const rows = json.list?.[0]?.all_content || [];
  if (!rows.length) {
    throw new Error("Transcript API returned no transcript rows.");
  }

  let output = "";
  if (format === "json") {
    output = JSON.stringify(json, null, 2) + "\n";
  } else {
    const lines = rows
      .map((row) => {
        const original = String(row.Text || "").replace(/\s+/g, " ").trim();
        return original ? `${hhmmss(row.BeginSec)} ${original}` : "";
      })
      .filter(Boolean);
    output = [
      "---",
      `date: ${dateFromSection}`,
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
  }

  if (out) {
    fs.writeFileSync(out, output);
  } else {
    process.stdout.write(output);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
