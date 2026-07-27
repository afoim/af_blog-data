/**
 * 将 img/ 下的 jpg/png/gif 统一转为 WebP，存入 dist/img/。
 * 在 generate-posts.js 之前跑：后者渲染 HTML 时 dist/img/ 里已有 WebP 文件。
 *
 * img/ 中已有 981 个 webp 文件不需要重复转换，只需处理 292 张旧格式。
 */
const { readdirSync, mkdirSync, statSync } = require("fs");
const { join } = require("path");
const sharp = require("sharp");

const IMG_IN = join(__dirname, "img");
const IMG_OUT = join(__dirname, "dist", "img");

/** 需要转 WebP 的旧格式，不含已优化过的 webp */
const CONVERT_RE = /\.(jpg|jpeg|png|gif)$/i;

async function main() {
  mkdirSync(IMG_OUT, { recursive: true });

  let files;
  try {
    files = readdirSync(IMG_IN);
  } catch (e) {
    console.error("WebP: cannot read img/ directory:", e.message);
    process.exit(1);
  }

  let converted = 0;
  let skipped = 0;
  let errors = 0;

  for (const fname of files) {
    if (!CONVERT_RE.test(fname)) {
      skipped++;
      continue;
    }

    const webpName = fname.replace(CONVERT_RE, ".webp");
    const srcPath = join(IMG_IN, fname);
    const dstPath = join(IMG_OUT, webpName);

    // 增量构建：WebP 已存在且 mtime 比源文件新就跳过
    try {
      const srcStat = statSync(srcPath);
      const dstStat = statSync(dstPath);
      if (dstStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
    } catch (_) {
      /* WebP 不存在，正常转换 */
    }

    try {
      const srcSize = statSync(srcPath).size;
      const start = Date.now();
      await sharp(srcPath)
        .webp({ quality: 80 })
        .toFile(dstPath);
      const dstSize = statSync(dstPath).size;
      const ratio = srcSize > 0 ? ((1 - dstSize / srcSize) * 100).toFixed(0) : "?";
      const ms = Date.now() - start;
      console.log(`WebP: ${fname} → ${webpName}  ${(srcSize / 1024).toFixed(0)}KB → ${(dstSize / 1024).toFixed(0)}KB (-${ratio}%) ${ms}ms`);
      converted++;
    } catch (e) {
      console.error(`WebP FAIL: ${fname} — ${e.message}`);
      errors++;
    }
  }

  console.log(`\nWebP done: ${converted} converted, ${skipped} skipped, ${errors} errors (${files.length} total in img/)`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error("WebP fatal:", e);
  process.exit(1);
});
