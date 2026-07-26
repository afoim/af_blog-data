<?xml version="1.0" encoding="UTF-8"?>
<!--
  RSS 的浏览器样式表（XSLT 1.0 —— 浏览器只实现到 1.0，别用 2.0 语法）。

  没有它时浏览器把订阅源摊成裸 XML，并顶一行
  "This XML file does not appear to have any style information associated with it."
  —— 那行提示是浏览器加的，不是文件内容，唯一的去除办法就是给出样式表。

  对阅读器无影响：RSS 客户端只读 XML 节点，处理指令会被忽略。

  **本文件在两个仓库各有一份**（svaf-next 的 public/xsl/ 与 eleventy-blog-pagescms
  的 xsl/），因为同一份 rss.xml 会从 2x.nz 和 raw-posts.2x.nz 两个域名提供，
  而 XSLT 受同源策略约束，跨域引用会被拒。改动时两边要一起改。
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">

  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/rss">
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title><xsl:value-of select="channel/title"/> · RSS</title>
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
          .wrap { max-width: 52rem; margin: 0 auto; }
          a { color: inherit; text-decoration: none; }

          .banner {
            border: 1px solid var(--border); padding: .75rem 1rem;
            margin-bottom: 1.5rem; background: var(--dim);
            font-size: .8rem; color: var(--muted);
          }
          .banner strong { color: var(--fg); font-weight: 600; }
          .url {
            display: block; margin-top: .5rem; padding: .4rem .6rem;
            border: 1px solid var(--border); background: var(--bg);
            color: var(--fg); font-size: .8rem;
            overflow-x: auto; white-space: nowrap;
          }

          h1 { font-size: 1.35rem; margin: 0 0 .35rem; font-weight: 600; letter-spacing: -.01em; }
          .desc { color: var(--muted); font-size: .85rem; margin: 0 0 .75rem; }
          .meta {
            display: flex; flex-wrap: wrap; gap: .5rem 1rem;
            color: var(--muted); font-size: .75rem;
            padding-bottom: 1.25rem; border-bottom: 1px solid var(--border);
          }
          .meta a { border-bottom: 1px solid var(--border); }
          .meta a:hover { color: var(--fg); border-bottom-color: currentColor; }

          .item {
            padding: 1rem 1rem 1rem 0; border-bottom: 1px solid var(--border);
            display: grid; grid-template-columns: 6.5rem 1fr; gap: 0 1rem;
          }
          .item:hover { background: var(--dim); padding-left: 1rem; }
          .date { color: var(--muted); font-size: .78rem; white-space: nowrap; padding-top: .15rem; }
          .title { font-size: .95rem; font-weight: 600; line-height: 1.45; }
          .title a { border-bottom: 1px solid transparent; }
          .item:hover .title a { border-bottom-color: currentColor; }
          .summary { color: var(--muted); font-size: .8rem; margin-top: .3rem; }
          .tags { margin-top: .4rem; display: flex; flex-wrap: wrap; gap: .35rem; }
          .tag {
            font-size: .7rem; color: var(--muted);
            border: 1px solid var(--border); padding: 0 .35rem;
          }
          @media (max-width: 560px) {
            .item { grid-template-columns: 1fr; }
            .date { padding-top: 0; margin-bottom: .25rem; }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="banner">
            这是一个 <strong>RSS 订阅源</strong>，不是网页。把下面的地址粘进阅读器即可订阅更新。
            <code class="url"><xsl:value-of select="channel/atom:link/@href"/></code>
          </div>

          <h1><xsl:value-of select="channel/title"/></h1>
          <p class="desc"><xsl:value-of select="channel/description"/></p>
          <div class="meta">
            <span><xsl:value-of select="count(channel/item)"/> 篇文章</span>
            <span>更新于 <xsl:value-of select="substring(channel/lastBuildDate, 6, 11)"/></span>
            <a href="{channel/link}">返回站点 →</a>
          </div>

          <xsl:for-each select="channel/item">
            <div class="item">
              <div class="date"><xsl:value-of select="substring(pubDate, 6, 11)"/></div>
              <div>
                <div class="title"><a href="{link}"><xsl:value-of select="title"/></a></div>
                <xsl:if test="description">
                  <div class="summary"><xsl:value-of select="description"/></div>
                </xsl:if>
                <xsl:if test="category">
                  <div class="tags">
                    <xsl:for-each select="category">
                      <span class="tag"><xsl:value-of select="."/></span>
                    </xsl:for-each>
                  </div>
                </xsl:if>
              </div>
            </div>
          </xsl:for-each>
        </div>
      </body>
    </html>
  </xsl:template>

</xsl:stylesheet>
