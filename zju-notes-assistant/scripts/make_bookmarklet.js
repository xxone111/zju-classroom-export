#!/usr/bin/env node

const script = String.raw`
(() => {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const sanitize = (value) => clean(value).replace(/[\\/:*?"<>|]/g, "_");
  const firstMatch = (text, patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match;
    }
    return null;
  };

  const pageText = document.body.innerText || "";
  const title = document.title || "zju-classroom-speech";
  const headerMatch = firstMatch(pageText, [
    /([^\n]+)\n(\d{4}-\d{2}-\d{2}第[^\n]+)\n\|\n([^\n]+)\n上课时间:/,
    /课程[:：]\s*([^\n]+)[\s\S]{0,120}?(\d{4}-\d{2}-\d{2}第[^\n\s]+)[\s\S]{0,120}?教师[:：]\s*([^\n]+)/,
    /([^\n]+?)\s+(\d{4}-\d{2}-\d{2}第[^\n\s]+)/
  ]);
  const titleParts = title.split(/[_|-]/).map(clean).filter(Boolean);
  const courseName = clean(headerMatch?.[1] || titleParts[0] || "课程");
  const section = clean(headerMatch?.[2] || firstMatch(pageText, [/\d{4}-\d{2}-\d{2}第[^\n\s]+/])?.[0] || "");
  const teacher = clean(headerMatch?.[3] || firstMatch(pageText, [/教师[:：]\s*([^\n\s]+)/, /主讲[:：]\s*([^\n\s]+)/])?.[1] || "");
  const date = (section.match(/\d{4}-\d{2}-\d{2}/) || pageText.match(/\d{4}-\d{2}-\d{2}/) || [new Date().toISOString().slice(0, 10)])[0];

  const rows = [...document.querySelectorAll(".trans-item")]
    .map((item) => {
      const time = clean(item.querySelector(".item-title")?.innerText || item.querySelector("[class*=time]")?.innerText || "");
      const original =
        clean(item.querySelector(".trans-lan > div:first-child")?.innerText || "") ||
        clean(item.querySelector(".trans-lan")?.childNodes?.[0]?.textContent || "") ||
        clean(item.querySelector("[class*=content]")?.innerText || "");
      return original ? (time ? time + " " + original : original) : "";
    })
    .filter(Boolean);

  if (!rows.length) {
    alert("没有抓到语音识别原文。请优先尝试页面右上角官方 DOCX 导出按钮；若使用 Markdown fallback，请确认当前在回放页，并且右侧“语音识别”内容已加载。");
    return;
  }

  const noteTitle = clean([courseName, section, teacher].filter(Boolean).join(" "));
  const filename = sanitize([courseName, section, teacher, "语音识别原文"].filter(Boolean).join("_")) + ".md";
  const markdown = [
    "---",
    "date: " + date,
    "up:",
    '  - "[[' + courseName.replace(/"/g, '\\"') + ']]"',
    "in:",
    "---",
    "",
    "# " + noteTitle,
    "",
    ...rows,
    "",
  ].join("\n");

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
})();
`;

const minified = script
  .replace(/^\s+|\s+$/gm, "")
  .replace(/\n+/g, " ");

process.stdout.write(`javascript:${minified}\n`);
