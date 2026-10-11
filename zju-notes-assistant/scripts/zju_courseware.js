const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const splitSetCookie = (value) => {
  if (!value) return [];
  const cookies = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < value.length; i += 1) {
    const chunk = value.slice(i, i + 8).toLowerCase();
    if (chunk === "expires=") inExpires = true;
    if (inExpires && value[i] === ";") inExpires = false;
    if (!inExpires && value[i] === ",") {
      cookies.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  cookies.push(value.slice(start).trim());
  return cookies.filter(Boolean);
};

const defaultCookiePath = (pathname) => {
  if (!pathname || !pathname.startsWith("/") || pathname === "/") return "/";
  const end = pathname.lastIndexOf("/");
  return end <= 0 ? "/" : pathname.slice(0, end);
};

const domainMatches = (hostname, domain, hostOnly) => {
  const host = hostname.toLowerCase();
  const target = domain.toLowerCase().replace(/^\./, "");
  return hostOnly ? host === target : host === target || host.endsWith(`.${target}`);
};

const pathMatches = (pathname, cookiePath) => {
  if (pathname === cookiePath) return true;
  if (!pathname.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || pathname[cookiePath.length] === "/";
};

class CookieJar {
  constructor(seed = []) {
    const rows = Array.isArray(seed) ? seed : Array.isArray(seed.cookies) ? seed.cookies : [];
    this.cookies = new Map();
    for (const row of rows) {
      if (!row || !row.name || !row.domain) continue;
      this.cookies.set(this.key(row), { ...row });
    }
  }

  key(cookie) {
    return `${cookie.domain.toLowerCase()}\t${cookie.path || "/"}\t${cookie.name}`;
  }

  addFromResponse(headers, responseUrl) {
    let values = [];
    if (typeof headers.getSetCookie === "function") values = headers.getSetCookie();
    else values = splitSetCookie(headers.get("set-cookie"));
    for (const value of values) this.setCookie(value, responseUrl);
  }

  setCookie(value, responseUrl) {
    const url = new URL(responseUrl);
    const parts = String(value).split(";").map((part) => part.trim());
    const first = parts.shift() || "";
    const separator = first.indexOf("=");
    if (separator <= 0) return;
    const cookie = {
      name: first.slice(0, separator),
      value: first.slice(separator + 1),
      domain: url.hostname.toLowerCase(),
      path: defaultCookiePath(url.pathname),
      hostOnly: true,
      secure: false,
      httpOnly: false,
      expires: null,
    };
    let maxAge = null;
    for (const attribute of parts) {
      const index = attribute.indexOf("=");
      const name = (index >= 0 ? attribute.slice(0, index) : attribute).trim().toLowerCase();
      const raw = index >= 0 ? attribute.slice(index + 1).trim() : "";
      if (name === "domain" && raw) {
        const domain = raw.toLowerCase().replace(/^\./, "");
        if (!domainMatches(url.hostname, domain, false)) continue;
        cookie.domain = domain;
        cookie.hostOnly = false;
      } else if (name === "path" && raw.startsWith("/")) cookie.path = raw;
      else if (name === "secure") cookie.secure = true;
      else if (name === "httponly") cookie.httpOnly = true;
      else if (name === "expires" && raw) {
        const parsed = Date.parse(raw);
        if (!Number.isNaN(parsed)) cookie.expires = parsed;
      } else if (name === "max-age" && /^-?\d+$/.test(raw)) maxAge = Number(raw);
    }
    if (maxAge !== null) cookie.expires = Date.now() + maxAge * 1000;
    const key = this.key(cookie);
    if (cookie.expires !== null && cookie.expires <= Date.now()) this.cookies.delete(key);
    else this.cookies.set(key, cookie);
  }

  header(requestUrl) {
    const url = new URL(requestUrl);
    const now = Date.now();
    const matches = [];
    for (const [key, cookie] of this.cookies.entries()) {
      if (cookie.expires !== null && cookie.expires <= now) {
        this.cookies.delete(key);
        continue;
      }
      if (cookie.secure && url.protocol !== "https:") continue;
      if (!domainMatches(url.hostname, cookie.domain, cookie.hostOnly)) continue;
      if (!pathMatches(url.pathname || "/", cookie.path || "/")) continue;
      matches.push(cookie);
    }
    matches.sort((a, b) => (b.path || "/").length - (a.path || "/").length);
    return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  toJSON() {
    return [...this.cookies.values()];
  }
}

const responseCookies = (auth) => {
  if (auth && auth.cookie_jar_version === 2 && Array.isArray(auth.cookies)) return auth.cookies;
  return [];
};

const requireScopedCookies = (auth) => {
  if (auth.cookie_jar_version !== 2 || !Array.isArray(auth.cookies)) {
    throw new Error("现有登录状态来自旧版本。为安全访问学在浙大，请在网页中重新登录一次。");
  }
};

const requestJson = async (request, jar, url, options = {}) => {
  const res = await request(jar, url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口没有返回 JSON：${text.slice(0, 160)}`);
  }
};

const learningRequest = async (request, auth, url, options = {}) => {
  requireScopedCookies(auth);
  const jar = new CookieJar(responseCookies(auth));
  const res = await request(jar, url, options);
  auth.cookies = jar.toJSON();
  return { res, jar };
};

const getAcademicYears = async (request, auth) => {
  const { res } = await learningRequest(
    request,
    auth,
    "https://courses.zju.edu.cn/api/my-academic-years?fields=id,name,sort,is_active",
    { accept: "application/json" }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`读取学年失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
  return JSON.parse(text).academic_years || [];
};

const getSemesters = async (request, auth) => {
  const { res } = await learningRequest(request, auth, "https://courses.zju.edu.cn/api/my-semesters?", {
    accept: "application/json",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`读取学期失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
  return JSON.parse(text).semesters || [];
};

const getLearningCourses = async (request, auth) => {
  const courses = [];
  let page = 1;
  while (true) {
    const payload = {
      fields:
        "id,name,course_code,academic_year_id,semester_id,start_date,end_date,is_started,is_closed,archived,instructors(id,name,email),course_attributes(teaching_class_name)",
      page,
      page_size: 100,
      conditions: {
        status: ["ongoing", "notStarted", "closed"],
        keyword: "",
        classify_type: "recently_started",
        display_studio_list: false,
      },
      showScorePassedStatus: false,
    };
    const { res } = await learningRequest(request, auth, "https://courses.zju.edu.cn/api/my-courses", {
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`读取课程失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    courses.push(...(Array.isArray(json.courses) ? json.courses : []));
    const pages = Number(json.pages || 1);
    if (page >= pages) break;
    page += 1;
  }
  return courses;
};

const uploadsFromRows = (rows, source, course) => {
  const uploads = [];
  for (const row of rows || []) {
    for (const upload of Array.isArray(row.uploads) ? row.uploads : []) {
      if (!upload || upload.id == null || upload.reference_id == null) continue;
      uploads.push({
        id: upload.id,
        reference_id: upload.reference_id,
        name: upload.name || `附件-${upload.id}`,
        size: Number(upload.size || 0),
        course_id: course.id,
        course_name: course.name || `课程-${course.id}`,
        source,
      });
    }
  }
  return uploads;
};

const getCourseUploads = async (request, auth, course, includeHomework = true) => {
  const activitiesUrl = `https://courses.zju.edu.cn/api/courses/${encodeURIComponent(course.id)}/activities`;
  const { res: activitiesRes } = await learningRequest(request, auth, activitiesUrl, { accept: "application/json" });
  const activitiesText = await activitiesRes.text();
  if (!activitiesRes.ok) {
    throw new Error(`读取“${course.name}”课件失败（HTTP ${activitiesRes.status}）：${activitiesText.slice(0, 160)}`);
  }
  const activities = JSON.parse(activitiesText);
  const uploads = uploadsFromRows(activities.activities, "教学活动", course);

  if (includeHomework) {
    let page = 1;
    while (true) {
      const conditions = encodeURIComponent(JSON.stringify({ itemsSortBy: { predicate: "module", reverse: false } }));
      const url = `https://courses.zju.edu.cn/api/courses/${encodeURIComponent(course.id)}/homework-activities?conditions=${conditions}&page=${page}&page_size=20&reloadPage=false`;
      const { res } = await learningRequest(request, auth, url, { accept: "application/json" });
      const text = await res.text();
      if (!res.ok) break;
      const json = JSON.parse(text);
      uploads.push(...uploadsFromRows(json.homework_activities, "作业活动", course));
      const pages = Number(json.pages || 1);
      if (page >= pages) break;
      page += 1;
    }
  }

  const unique = new Map();
  for (const upload of uploads) unique.set(String(upload.reference_id), upload);
  return [...unique.values()];
};

const decodeContentDispositionName = (value) => {
  if (!value) return "";
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const simple = value.match(/filename="?([^";]+)"?/i);
  if (!simple) return "";
  const name = simple[1];
  if (!/[ÃÂâåçæäéè]/.test(name)) return name;
  const repaired = Buffer.from(name, "latin1").toString("utf8");
  return repaired.includes("�") ? name : repaired;
};

const safePart = (value, fallback = "未命名") => {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
};

const uniquePath = (target) => {
  if (!fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`无法为文件生成不重复名称：${target}`);
};

const downloadLearningFile = async (request, auth, upload, outputDir) => {
  requireScopedCookies(auth);
  const jar = new CookieJar(responseCookies(auth));
  const primary = `https://courses.zju.edu.cn/api/uploads/reference/${encodeURIComponent(upload.reference_id)}/blob`;
  let res = await request(jar, primary);
  if (!res.ok) {
    const fallback = `https://courses.zju.edu.cn/api/uploads/${encodeURIComponent(upload.id)}/blob`;
    res = await request(jar, fallback);
  }
  auth.cookies = jar.toJSON();
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
  const contentType = String(res.headers.get("content-type") || "");
  if (contentType.includes("text/html")) throw new Error("登录状态已失效，请重新登录。");
  const serverName = decodeContentDispositionName(res.headers.get("content-disposition"));
  const courseDir = path.join(outputDir, safePart(upload.course_name, "课程"));
  fs.mkdirSync(courseDir, { recursive: true });
  const target = uniquePath(path.join(courseDir, safePart(serverName || upload.name, `附件-${upload.id}`)));
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, bytes);
  return { file: target, bytes: bytes.length };
};

const getPptUrls = async (request, auth, courseId, subId) => {
  const jar = new CookieJar(responseCookies(auth));
  const headers = auth.token
    ? { Authorization: auth.token.startsWith("Bearer ") ? auth.token : `Bearer ${auth.token}` }
    : {};
  const urls = [];
  let page = 1;
  let total = 0;
  do {
    const endpoint = `https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}&page=${page}&per_page=100`;
    const json = await requestJson(request, jar, endpoint, { accept: "application/json", headers });
    total = Number(json.total || 0);
    for (const row of Array.isArray(json.list) ? json.list : []) {
      let content = row.content;
      if (typeof content === "string") {
        try {
          content = JSON.parse(content);
        } catch {
          content = {};
        }
      }
      if (content && content.pptimgurl) urls.push(String(content.pptimgurl));
    }
    page += 1;
  } while (urls.length < total && page <= Math.ceil(total / 100) + 2);
  auth.cookies = jar.toJSON();
  return urls;
};

const downloadBuffer = async (request, jar, url, headers = {}) => {
  const res = await request(jar, url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error("返回内容为空");
  return bytes;
};

const jpegInfo = (bytes) => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const components = bytes[offset + 9];
      return {
        kind: "jpeg",
        width: bytes.readUInt16BE(offset + 7),
        height: bytes.readUInt16BE(offset + 5),
        colors: components === 1 ? 1 : components === 4 ? 4 : 3,
        data: bytes,
      };
    }
    if (length < 2) break;
    offset += length + 2;
  }
  throw new Error("无法读取 JPEG 尺寸");
};

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

const unfilterPng = (raw, width, height, channels) => {
  const stride = width * channels;
  const output = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source++];
    const row = y * stride;
    const prior = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source++];
      const left = x >= channels ? output[row + x - channels] : 0;
      const up = y > 0 ? output[prior + x] : 0;
      const upperLeft = y > 0 && x >= channels ? output[prior + x - channels] : 0;
      if (filter === 0) output[row + x] = value;
      else if (filter === 1) output[row + x] = (value + left) & 255;
      else if (filter === 2) output[row + x] = (value + up) & 255;
      else if (filter === 3) output[row + x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) output[row + x] = (value + paeth(left, up, upperLeft)) & 255;
      else throw new Error(`不支持的 PNG 过滤器：${filter}`);
    }
  }
  return output;
};

const pngInfo = (bytes) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error("暂不支持这种 PNG 编码。");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) throw new Error("仅支持 8 位灰度/RGB PNG。");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const pixels = unfilterPng(zlib.inflateSync(Buffer.concat(idat)), width, height, channels);
  const hasAlpha = colorType === 4 || colorType === 6;
  const colors = colorType === 0 || colorType === 4 ? 1 : 3;
  const image = Buffer.alloc(width * height * colors);
  const alpha = hasAlpha ? Buffer.alloc(width * height) : null;
  for (let source = 0, target = 0, mask = 0; source < pixels.length; source += channels) {
    for (let channel = 0; channel < colors; channel += 1) image[target++] = pixels[source + channel];
    if (alpha) alpha[mask++] = pixels[source + channels - 1];
  }
  return {
    kind: "png",
    width,
    height,
    colors,
    data: zlib.deflateSync(image),
    alpha: alpha ? zlib.deflateSync(alpha) : null,
  };
};

const imageInfo = (bytes) => jpegInfo(bytes) || pngInfo(bytes);

const pdfObject = (id, body) => Buffer.concat([Buffer.from(`${id} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
const pdfStream = (dictionary, data) =>
  Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]);

const imagesToPdf = (imageBuffers, target) => {
  if (!imageBuffers.length) throw new Error("这节课没有可导出的课件页。");
  const images = imageBuffers.map(imageInfo);
  if (images.some((image) => !image)) throw new Error("课件包含暂不支持的图片格式。");
  const objects = new Map();
  const pageIds = [];
  let nextId = 3;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const pageId = nextId++;
    const contentId = nextId++;
    const imageId = nextId++;
    const alphaId = image.alpha ? nextId++ : null;
    pageIds.push(pageId);
    const imageName = `/Im${index + 1}`;
    const colorSpace = image.colors === 1 ? "/DeviceGray" : image.colors === 4 ? "/DeviceCMYK" : "/DeviceRGB";
    const filter = image.kind === "jpeg" ? "/DCTDecode" : "/FlateDecode";
    const alphaRef = alphaId ? ` /SMask ${alphaId} 0 R` : "";
    objects.set(
      imageId,
      pdfStream(
        `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter ${filter}${alphaRef}`,
        image.data
      )
    );
    if (alphaId) {
      objects.set(
        alphaId,
        pdfStream(
          `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
          image.alpha
        )
      );
    }
    const content = Buffer.from(`q\n${image.width} 0 0 ${image.height} 0 0 cm\n${imageName} Do\nQ\n`);
    objects.set(contentId, pdfStream("", content));
    objects.set(
      pageId,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << ${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    );
  }
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`));
  const maxId = nextId - 1;
  const chunks = [Buffer.from("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;
  for (let id = 1; id <= maxId; id += 1) {
    const object = pdfObject(id, objects.get(id));
    offsets[id] = length;
    chunks.push(object);
    length += object.length;
  }
  const xrefOffset = length;
  const xref = [`xref\n0 ${maxId + 1}\n`, "0000000000 65535 f \n"];
  for (let id = 1; id <= maxId; id += 1) xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join("")));
  fs.writeFileSync(target, Buffer.concat(chunks));
};

const exportReplaySlides = async (request, auth, row, outputDir) => {
  const urls = await getPptUrls(request, auth, row.course_id, row.sub_id);
  if (!urls.length) throw new Error("这节回放没有找到课件页。");
  const jar = new CookieJar(responseCookies(auth));
  const headers = auth.token
    ? { Authorization: auth.token.startsWith("Bearer ") ? auth.token : `Bearer ${auth.token}` }
    : {};
  const images = [];
  for (const url of urls) images.push(await downloadBuffer(request, jar, url, headers));
  auth.cookies = jar.toJSON();
  const folder = path.join(outputDir, safePart(row.course_name, "课程"));
  fs.mkdirSync(folder, { recursive: true });
  const base = [row.date, row.course_name, row.section, "课件"].filter(Boolean).map((part) => safePart(part)).join("_");
  const target = uniquePath(path.join(folder, `${base || row.sub_id}.pdf`));
  imagesToPdf(images, target);
  return { file: target, pages: images.length };
};

module.exports = {
  CookieJar,
  responseCookies,
  requireScopedCookies,
  getAcademicYears,
  getSemesters,
  getLearningCourses,
  getCourseUploads,
  downloadLearningFile,
  getPptUrls,
  imagesToPdf,
  exportReplaySlides,
};
