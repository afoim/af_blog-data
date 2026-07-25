/**
 * 从 posts/*.md 中提取 frontmatter，生成 posts.json
 * 供 svaf-next 获取文章列表
 */
const { readdirSync, readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");
const { marked } = require("marked");

const POSTS_DIR = join(__dirname, "posts");
const OUTPUT = join(__dirname, "posts.json");
var FEED_OUTPUT = join(__dirname, "rss.xml");
var SELF_URL = "https://2x.nz/rss.xml";

const SITE_URL = "https://raw-posts.2x.nz/";
const SITE_TITLE = "博客 | 二叉树树";
const SITE_DESC = "《二叉树树》是一个专注于IT/互联网技术分享与实践的个人技术博客，在这里你可以找到众多前沿技术的分享与实践经验。";
const AUTHOR_NAME = "二叉树树";
const AUTHOR_EMAIL = "acofork@qq.com";

/** Convert a relative URL to absolute using SITE_URL */
function absUrl(url) {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  var base = SITE_URL.replace(/\/$/, "");
  var path = url.startsWith("/") ? url : "/" + url;
  return base + path;
}

// --- Configure marked to use absUrl for images and links ---
var renderer = new marked.Renderer();
renderer.image = function (tok) {
  var href = tok.href ? absUrl(tok.href) : "";
  var alt = tok.text || "";
  return '<img src="' + href + '" alt="' + alt.replace(/"/g, "&quot;") + '" />';
};
renderer.link = function (tok) {
  var href = tok.href ? absUrl(tok.href) : "";
  return '<a href="' + href + '">' + tok.text + "</a>";
};
marked.setOptions({ renderer: renderer, breaks: false, gfm: true });

/** Parse YAML-like frontmatter into a map */
function parseFrontmatter(fm) {
  const lines = fm.split("\n");
  const result = {};
  let currentKey = null;
  let currentList = [];

  for (const line of lines) {
    // Key: value
    const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kvMatch) {
      // Flush previous list
      if (currentKey && currentList.length) {
        result[currentKey] = [...currentList];
        currentList = [];
      }
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === "") {
        // Could be a list starting next line
        currentList = [];
      } else if (val.startsWith("[")) {
        // Inline list: [a, b, c]
        result[currentKey] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        currentKey = null;
      } else {
        result[currentKey] = val.replace(/^['"]|['"]$/g, "");
        currentKey = null;
      }
      continue;
    }
    // List item:  - value
    const liMatch = line.match(/^\s*-\s+(.*)$/);
    if (liMatch && currentKey) {
      currentList.push(liMatch[1].trim().replace(/^['"]|['"]$/g, ""));
    }
  }
  // Flush final list
  if (currentKey && currentList.length) {
    result[currentKey] = [...currentList];
  }

  return result;
}

const posts = [];
const rawPosts = [];

for (const file of readdirSync(POSTS_DIR)) {
  if (!file.endsWith(".md") && !file.endsWith(".markdown")) continue;

  // 归一化 CRLF → LF，使前言解析在 Windows（本地）与 Linux（CI）行为一致，
  // 否则 CRLF 文件的 `---\r\n` 会让 `^---\n` 正则失配、整篇文章被丢弃。
  const raw = readFileSync(join(POSTS_DIR, file), "utf-8").replace(/\r\n/g, "\n");
  const slug = file.replace(/\.(md|markdown)$/, "");

  // Parse frontmatter
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    console.warn("⚠️  " + file + ": no frontmatter found");
    continue;
  }

  const fm = parseFrontmatter(match[1]);
  const body = raw.slice(match[0].length);

  rawPosts.push({ slug, body });

  if (!fm.title) {
    console.warn("⚠️  " + file + ": no title");
    continue;
  }

  posts.push({
    slug,
    title: fm.title,
    description: fm.description || "",
    published: fm.date || "",
    image: fm.coverImage ? absUrl(fm.coverImage) : null,
    pinned: fm.pin === true || fm.pin === "true",
    draft: fm.draft === true || fm.draft === "true",
    hide: fm.hide === true || fm.hide === "true",
    category: fm.category || undefined,
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    lang: fm.lang || undefined,
    ai_level: fm.ai_level ? Number(fm.ai_level) : undefined,
  });
}

// Sort by date desc (newest first)
posts.sort((a, b) => {
  if (a.published && b.published) return b.published.localeCompare(a.published);
  if (a.published) return -1;
  if (b.published) return 1;
  return 0;
});

// ---- Paginated index + page files ----
// posts.json 从「全量数组」升级为「索引对象」：{ generatedAt, perPage, total, pageCount, posts }。
// posts 为可见文章（已过滤 draft/hide），排序为置顶优先、再按日期倒序——
// 使前端可直接按页渲染 posts-{n}.json，page 0 即置顶 + 最新。
// 索引仍携带每篇完整元数据，供搜索/上下篇/sitemap/边缘 meta 读取 .posts；
// 各 posts-{n}.json 为该顺序下每 30 篇一片，供列表页按需拉取。
var PER_PAGE = 30;
var visibleSorted = posts
  .filter(function (p) { return !p.draft && !p.hide; })
  .sort(function (a, b) {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.published && b.published) return b.published.localeCompare(a.published);
    if (a.published) return -1;
    if (b.published) return 1;
    return 0;
  });
var total = visibleSorted.length;
var pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
var generatedAt = new Date().toISOString();

writeFileSync(
  OUTPUT,
  JSON.stringify({ generatedAt: generatedAt, perPage: PER_PAGE, total: total, pageCount: pageCount, posts: visibleSorted }, null, 2),
  "utf-8"
);
console.log("Rewrote posts.json as paginated index: " + total + " visible posts, " + pageCount + " pages");

for (var pg = 0; pg < pageCount; pg++) {
  var slice = visibleSorted.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);
  writeFileSync(
    join(__dirname, "posts-" + pg + ".json"),
    JSON.stringify({ page: pg, perPage: PER_PAGE, total: total, pageCount: pageCount, posts: slice }, null, 2),
    "utf-8"
  );
}
console.log("Generated " + pageCount + " page files (posts-0.json .. posts-" + (pageCount - 1) + ".json)");

// ---- Rewrite Markdown: convert relative paths to absolute ----
var POSTS_OUT = join(__dirname, "dist", "posts");

// Ensure dist/ and dist/posts/ exist
mkdirSync(join(__dirname, "dist"), { recursive: true });
mkdirSync(POSTS_OUT, { recursive: true });

/** Rewrite relative URL references in Markdown body to absolute */
function rewriteMarkdownPaths(mdBody) {
  mdBody = mdBody.replace(/\/img\//g, SITE_URL.replace(/\/$/, "") + "/img/");
  mdBody = mdBody.replace(/(?<!!)\[([^\]]+)\]\((\/[^)]+)\)/g, function (_, text, url) {
    if (url.indexOf(SITE_URL.replace(/\/$/, "")) >= 0) return _;
    return "[" + text + "](" + absUrl(url) + ")";
  });
  return mdBody;
}

// Write rewritten .md files to dist/posts/ so the frontend gets absolute URLs
for (var fi = 0; fi < rawPosts.length; fi++) {
  var origSlug = rawPosts[fi].slug;
  var origFile = origSlug + ".md";
  var src = readFileSync(join(POSTS_DIR, origFile), "utf-8");
  var rewritten = rewriteMarkdownPaths(src);
  writeFileSync(join(POSTS_OUT, origFile), rewritten, "utf-8");
}
console.log("Rewrote " + rawPosts.length + " Markdown files to dist/posts/ with absolute URLs");

// ---- RSS 2.0 Feed ----
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822Date(dateStr) {
  if (!dateStr) return new Date().toUTCString();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

/** Build an RSS 2.0 feed from the visible (non-draft, non-hidden) posts */
function generateRssFeed(allPosts, allRawPosts) {
  var RSS_URL = "https://2x.nz/";
  var visible = allPosts.filter(function (p) { return !p.draft && !p.hide; });
  var lastBuildDate =
    visible.length > 0 ? toRfc822Date(visible[0].published) : new Date().toUTCString();

  // Build a map of slug to raw Markdown body for quick lookup
  var bodyMap = {};
  for (var i = 0; i < allRawPosts.length; i++) {
    bodyMap[allRawPosts[i].slug] = allRawPosts[i].body;
  }

  var lines = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">');
  lines.push("  <channel>");
  lines.push("    <title>" + escapeXml(SITE_TITLE) + "</title>");
  lines.push("    <link>" + escapeXml(RSS_URL) + "</link>");
  lines.push("    <description>" + escapeXml(SITE_DESC) + "</description>");
  lines.push("    <language>zh-CN</language>");
  lines.push("    <lastBuildDate>" + lastBuildDate + "</lastBuildDate>");
  lines.push("    <generator>generate-posts.js (Eleventy CMS)</generator>");
  lines.push('    <atom:link href="' + escapeXml(SELF_URL) + '" rel="self" type="application/rss+xml"/>');
  lines.push("    <managingEditor>" + escapeXml(AUTHOR_EMAIL) + " (" + escapeXml(AUTHOR_NAME) + ")</managingEditor>");
  lines.push("    <webMaster>" + escapeXml(AUTHOR_EMAIL) + " (" + escapeXml(AUTHOR_NAME) + ")</webMaster>");

  for (var j = 0; j < visible.length; j++) {
    var post = visible[j];
    var postUrl = RSS_URL + "posts/" + post.slug + "/";

    // Convert Markdown body to HTML using marked
    var rawBody = bodyMap[post.slug] || "";
    var contentHtml = marked.parse(rawBody);

    // Full HTML with cover image at top if available
    var fullContent = "";
    if (post.image) {
      fullContent += '<p><img src="' + absUrl(post.image) + '" alt="' + escapeXml(post.title) + '" /></p>';
    }
    if (post.description) {
      fullContent += "<p>" + escapeXml(post.description) + "</p>";
    }
    fullContent += contentHtml;

    lines.push("    <item>");
    lines.push("      <title>" + escapeXml(post.title) + "</title>");
    lines.push("      <link>" + escapeXml(postUrl) + "</link>");
    lines.push('      <guid isPermaLink="true">' + escapeXml(postUrl) + "</guid>");
    lines.push("      <pubDate>" + toRfc822Date(post.published) + "</pubDate>");

    if (post.description) {
      lines.push("      <description>" + escapeXml(post.description) + "</description>");
    }

    // Full article content (CDATA-wrapped for HTML)
    lines.push("      <content:encoded><![CDATA[" + fullContent + "]]></content:encoded>");

    // Cover image as media:content (for follow.io and other readers)
    if (post.image) {
      var ext = (post.image.toLowerCase().match(/\.\w+$/) || [""])[0];
      var mime = MIME_MAP[ext] || "image/jpeg";
      lines.push('      <media:content url="' + absUrl(post.image) + '" type="' + mime + '" medium="image" />');
      lines.push('      <media:thumbnail url="' + absUrl(post.image) + '" />');
    }

    // Categories / tags
    if (Array.isArray(post.tags)) {
      for (var k = 0; k < post.tags.length; k++) {
        lines.push("      <category>" + escapeXml(post.tags[k]) + "</category>");
      }
    }
    if (post.category) {
      lines.push("      <category>" + escapeXml(post.category) + "</category>");
    }

    lines.push("    </item>");
  }

  lines.push("  </channel>");
  lines.push("</rss>");
  return lines.join("\n") + "\n";
}

writeFileSync(FEED_OUTPUT, generateRssFeed(posts, rawPosts), "utf-8");
console.log("Generated rss.xml with " + posts.filter(function (p) { return !p.draft && !p.hide; }).length + " entries (RSS 2.0)");

// Write into dist/ so deploy.yml only needs to copy img/ and _headers.
// posts.json（索引对象）与所有 posts-{n}.json 分页文件一并进入 dist。
writeFileSync(
  join(__dirname, "dist", "posts.json"),
  JSON.stringify({ generatedAt: generatedAt, perPage: PER_PAGE, total: total, pageCount: pageCount, posts: visibleSorted }, null, 2),
  "utf-8"
);
for (var dpg = 0; dpg < pageCount; dpg++) {
  var dslice = visibleSorted.slice(dpg * PER_PAGE, (dpg + 1) * PER_PAGE);
  writeFileSync(
    join(__dirname, "dist", "posts-" + dpg + ".json"),
    JSON.stringify({ page: dpg, perPage: PER_PAGE, total: total, pageCount: pageCount, posts: dslice }, null, 2),
    "utf-8"
  );
}
writeFileSync(join(__dirname, "dist", "rss.xml"), readFileSync(FEED_OUTPUT, "utf-8"), "utf-8");
console.log("Copied posts.json + " + pageCount + " page files + rss.xml into dist/");

// ---- SEO 静态预渲染页 (dist/seo/posts/<slug>.html) ----
// 目的：把主仓边缘 Worker「给爬虫动态拼 HTML」的活挪到构建时。
// 产物是零样式、零 JS 的纯语义 HTML，供 UA 重写规则把爬虫导流到
// raw-posts.2x.nz/seo/posts/<slug> 直接取用，避免动态 Worker 请求计费。
//
// 路径策略（与主站约定一致）：
//   - 图片等硬资源 → 绝对 URL（内容托管在 raw-posts.2x.nz）
//   - 其余站内链接 → 相对路径（无域名，两域名下都可用）
//   - canonical / og:url / JSON-LD 页面地址 → 硬指向权威域名 2x.nz（防收录分裂）
// SEO 常量对齐主仓 src/lib/seo/route-meta.ts 与 worker/index.ts。
var MAIN_URL = "https://2x.nz"; // 权威域名（用户真正访问的站点）
var MAIN_NAME = "二叉树树";
var DEFAULT_OG_IMAGE = MAIN_URL + "/files/img/official.png";

// 专供 SEO 页的 marked 渲染器：图片转绝对（硬资源），链接保持原样（相对不动）
var seoRenderer = new marked.Renderer();
seoRenderer.image = function (tok) {
  var href = tok.href ? absUrl(tok.href) : "";
  var alt = tok.text || "";
  return '<img src="' + href + '" alt="' + alt.replace(/"/g, "&quot;") + '" loading="lazy" />';
};
seoRenderer.link = function (tok) {
  var href = tok.href || "";
  return '<a href="' + href + '">' + tok.text + "</a>";
};
var Marked = require("marked").Marked;
var seoMarked = new Marked({ renderer: seoRenderer, breaks: false, gfm: true });

/** <title> 拼接：`标题 | 二叉树树`（对齐主仓 formatTitle） */
function seoTitle(t) {
  return escapeXml(t + " | " + MAIN_NAME);
}

/** 单篇文章的完整 SEO HTML 文档 */
function buildPostSeoHtml(post, bodyHtml) {
  var pageUrl = MAIN_URL + "/posts/" + encodeURIComponent(post.slug);
  var description = post.description || post.title + " —— 来自二叉树树的博客文章。";
  var image = post.image || DEFAULT_OG_IMAGE;
  var fullTitle = post.title + " | " + MAIN_NAME;

  var ld = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: description,
    datePublished: post.published || undefined,
    image: image, // 富媒体文章卡要求有图，无封面退回站点默认分享图
    keywords: post.tags && post.tags.length ? post.tags.join(",") : undefined,
    inLanguage: "zh-CN",
    author: { "@type": "Person", name: "AcoFork", url: MAIN_URL },
    mainEntityOfPage: pageUrl,
  };
  var jsonLd = JSON.stringify(ld).replace(/</g, "\\u003c");

  var h = [];
  h.push("<!doctype html>");
  h.push('<html lang="zh-CN">');
  h.push("<head>");
  h.push('<meta charset="utf-8" />');
  h.push("<title>" + seoTitle(post.title) + "</title>");
  h.push('<meta name="description" content="' + escapeXml(description) + '" />');
  h.push('<meta name="robots" content="index, follow" />');
  h.push('<link rel="canonical" href="' + escapeXml(pageUrl) + '" />');
  h.push('<meta property="og:site_name" content="' + escapeXml(MAIN_NAME) + '" />');
  h.push('<meta property="og:title" content="' + escapeXml(fullTitle) + '" />');
  h.push('<meta property="og:description" content="' + escapeXml(description) + '" />');
  h.push('<meta property="og:url" content="' + escapeXml(pageUrl) + '" />');
  h.push('<meta property="og:type" content="article" />');
  h.push('<meta property="og:image" content="' + escapeXml(image) + '" />');
  if (post.published) {
    h.push('<meta property="article:published_time" content="' + escapeXml(post.published) + '" />');
  }
  if (Array.isArray(post.tags)) {
    for (var t = 0; t < post.tags.length; t++) {
      h.push('<meta property="article:tag" content="' + escapeXml(post.tags[t]) + '" />');
    }
  }
  h.push('<meta name="twitter:card" content="summary_large_image" />');
  h.push('<meta name="twitter:title" content="' + escapeXml(fullTitle) + '" />');
  h.push('<meta name="twitter:description" content="' + escapeXml(description) + '" />');
  h.push('<meta name="twitter:image" content="' + escapeXml(image) + '" />');
  h.push('<script type="application/ld+json">' + jsonLd + "</script>");
  h.push("</head>");
  h.push("<body>");
  h.push('<nav><a href="/seo/posts">← 博客文章</a></nav>');
  h.push("<article>");
  h.push("<h1>" + escapeXml(post.title) + "</h1>");
  h.push(bodyHtml);
  h.push("</article>");
  h.push("</body>");
  h.push("</html>");
  return h.join("\n") + "\n";
}

/** SEO 文章列表页（爬虫抓取入口，链接指向同树 /seo/posts/<slug>） */
function buildListSeoHtml(list) {
  var listUrl = MAIN_URL + "/posts";
  var items = list
    .map(function (p) {
      var date = /^\d{4}-\d{2}-\d{2}/.test(p.published)
        ? '<time datetime="' + p.published.slice(0, 10) + '">' + p.published.slice(0, 10) + "</time> "
        : "";
      return (
        "<li>" +
        date +
        '<a href="/seo/posts/' +
        encodeURIComponent(p.slug) +
        '">' +
        escapeXml(p.title) +
        "</a></li>"
      );
    })
    .join("\n");
  var h = [];
  h.push("<!doctype html>");
  h.push('<html lang="zh-CN">');
  h.push("<head>");
  h.push('<meta charset="utf-8" />');
  h.push("<title>" + seoTitle("博客文章") + "</title>");
  h.push('<meta name="description" content="' + escapeXml(SITE_DESC) + '" />');
  h.push('<meta name="robots" content="index, follow" />');
  h.push('<link rel="canonical" href="' + escapeXml(listUrl) + '" />');
  h.push('<meta property="og:site_name" content="' + escapeXml(MAIN_NAME) + '" />');
  h.push('<meta property="og:title" content="' + escapeXml("博客文章 | " + MAIN_NAME) + '" />');
  h.push('<meta property="og:description" content="' + escapeXml(SITE_DESC) + '" />');
  h.push('<meta property="og:url" content="' + escapeXml(listUrl) + '" />');
  h.push('<meta property="og:type" content="website" />');
  h.push('<meta property="og:image" content="' + escapeXml(DEFAULT_OG_IMAGE) + '" />');
  h.push("</head>");
  h.push("<body>");
  h.push("<h1>博客文章</h1>");
  h.push("<ul>");
  h.push(items);
  h.push("</ul>");
  h.push("</body>");
  h.push("</html>");
  return h.join("\n") + "\n";
}

var SEO_OUT = join(__dirname, "dist", "seo", "posts");
mkdirSync(SEO_OUT, { recursive: true });

// slug → 去 frontmatter 后的正文（rawPosts 已按 LF 归一化并剥离 frontmatter）
var seoBodyMap = {};
for (var sb = 0; sb < rawPosts.length; sb++) {
  seoBodyMap[rawPosts[sb].slug] = rawPosts[sb].body;
}

for (var vi = 0; vi < visibleSorted.length; vi++) {
  var vpost = visibleSorted[vi];
  var vbody = seoMarked.parse(seoBodyMap[vpost.slug] || "");
  writeFileSync(join(SEO_OUT, vpost.slug + ".html"), buildPostSeoHtml(vpost, vbody), "utf-8");
}
writeFileSync(join(__dirname, "dist", "seo", "posts.html"), buildListSeoHtml(visibleSorted), "utf-8");
console.log(
  "Generated " + visibleSorted.length + " SEO pages into dist/seo/posts/ + list dist/seo/posts.html"
);
