<?xml version="1.0" encoding="UTF-8"?>
<!--
  Sitemap 的浏览器样式表（XSLT 1.0 —— 浏览器只实现到 1.0，别用 2.0 语法）。

  没有它时浏览器渲染成默认 XML 文档树，并顶一行
  "This XML file does not appear to have any style information associated with it."
  —— 那行提示是浏览器加的，不是文件内容，唯一的去除办法就是给出样式表。

  对爬虫无影响：Google/Bing 只读 XML 节点，处理指令会被忽略。

  一份模板兼顾两种文档：sitemapindex（分片索引）与 urlset（URL 列表）。

  **本文件在两个仓库各有一份**（svaf-next 的 public/xsl/ 与 eleventy-blog-pagescms
  的 xsl/），因为 sitemap 会从 2x.nz 和 raw-posts.2x.nz 两个域名提供，而 XSLT
  受同源策略约束，跨域引用会被拒。改动时两边要一起改。
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">

  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>Sitemap · 二叉树树</title>
        <style>
          :root {
            --bg: #171717; --fg: #e8e8e8; --muted: #8f8f8f;
            --border: #3a3a3a; --dim: #1f1f1f;
          }
          @media (prefers-color-scheme: light) {
            :root {
              --bg: #ffffff; --fg: #171717; --muted: #6b6b6b;
              --border: #d4d4d4; --dim: #f5f5f5;
            }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0; padding: 2rem 1rem 4rem;
            background: var(--bg); color: var(--fg);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
            font-size: 14px; line-height: 1.65;
            overflow-wrap: break-word;
          }
          .wrap { max-width: 64rem; margin: 0 auto; }
          a { color: inherit; text-decoration: none; }

          .banner {
            border: 1px solid var(--border); padding: .75rem 1rem;
            margin-bottom: 1.5rem; background: var(--dim);
            font-size: .8rem; color: var(--muted);
          }
          .banner strong { color: var(--fg); font-weight: 600; }

          h1 { font-size: 1.35rem; margin: 0 0 .35rem; font-weight: 600; letter-spacing: -.01em; }
          .meta {
            display: flex; flex-wrap: wrap; gap: .5rem 1rem;
            color: var(--muted); font-size: .75rem;
            padding-bottom: 1.25rem; border-bottom: 1px solid var(--border);
            margin-bottom: 1rem;
          }
          .meta a { border-bottom: 1px solid var(--border); }
          .meta a:hover { color: var(--fg); border-bottom-color: currentColor; }

          .scroll { overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
          th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid var(--border); }
          th {
            font-weight: 600; font-size: .7rem; text-transform: uppercase;
            letter-spacing: .06em; color: var(--muted); background: var(--dim);
          }
          tr:last-child td { border-bottom: 0; }
          tbody tr:hover { background: var(--fg); color: var(--bg); }
          td a { border-bottom: 1px solid transparent; }
          tbody tr:hover td a { border-bottom-color: currentColor; }
          .num { color: var(--muted); width: 3.5rem; }
          tbody tr:hover .num, tbody tr:hover .date { color: inherit; }
          .date { color: var(--muted); white-space: nowrap; width: 7rem; font-size: .8rem; }
          @media (max-width: 640px) { .num { display: none; } }
        </style>
      </head>
      <body>
        <div class="wrap">
          <xsl:apply-templates/>
        </div>
      </body>
    </html>
  </xsl:template>

  <!-- 分片索引 -->
  <xsl:template match="sm:sitemapindex">
    <div class="banner">
      这是一个 <strong>Sitemap 索引</strong>，供搜索引擎抓取用。下面每一项都是一个分片。
    </div>
    <h1>Sitemap 索引</h1>
    <div class="meta">
      <span><xsl:value-of select="count(sm:sitemap)"/> 个分片</span>
      <a href="/">返回站点 →</a>
    </div>
    <div class="scroll">
      <table>
        <thead>
          <tr><th class="num">#</th><th>分片地址</th><th class="date">更新时间</th></tr>
        </thead>
        <tbody>
          <xsl:for-each select="sm:sitemap">
            <tr>
              <td class="num"><xsl:value-of select="position()"/></td>
              <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
              <td class="date"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></td>
            </tr>
          </xsl:for-each>
        </tbody>
      </table>
    </div>
  </xsl:template>

  <!-- URL 列表 -->
  <xsl:template match="sm:urlset">
    <div class="banner">
      这是一个 <strong>Sitemap</strong>，供搜索引擎抓取用，列出本站可被索引的地址。
    </div>
    <h1>Sitemap</h1>
    <div class="meta">
      <span><xsl:value-of select="count(sm:url)"/> 条 URL</span>
      <a href="/sitemap.xml">返回索引</a>
      <a href="/">返回站点 →</a>
    </div>
    <div class="scroll">
      <table>
        <thead>
          <tr><th class="num">#</th><th>URL</th><th class="date">最后修改</th></tr>
        </thead>
        <tbody>
          <xsl:for-each select="sm:url">
            <tr>
              <td class="num"><xsl:value-of select="position()"/></td>
              <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
              <td class="date"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></td>
            </tr>
          </xsl:for-each>
        </tbody>
      </table>
    </div>
  </xsl:template>

</xsl:stylesheet>
