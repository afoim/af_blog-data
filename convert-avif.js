/**
 * 将 img/ 下的 jpg/png/gif 统一转为 AVIF，存入 dist/img/。
 * 在 generate-posts.js 之前跑：后者渲染 HTML 时 dist/img/ 里已有 AVIF 文件。
 */
const { readdirSync, mkdirSync, statSync } = require("fs");
const { join, extname } = require("path");
const sharp = require("sharp");

const IMG_IN = join(__dirname, "img");
const IMG_OUT = join(__dirname, "dist", "img");

const AVIF_EXT_RE = /\.(jpg|jpeg|png|gif)$/i;

async function main() {
  mkdirSync(IMG_OUT, { recursive: true });

  let files;
  try {
    files = readdirSync(IMG_IN);
  } catch (e) {
    console.error("AVIF: cannot read img/ directory:", e.message);
    process.exit(1);
  }

  let converted = 0;
  let skipped = 0;
  let errors = 0;

  for (const fname of files) {
    if (!AVIF_EXT_RE.test(fname)) {
      skipped++;
      continue;
    }

    const avifName = fname.replace(AVIF_EXT_RE, ".avif");
    const srcPath = join(IMG_IN, fname);
    const dstPath = join(IMG_OUT, avifName);

    // 增量构建：AVIF 已存在且比源文件新就跳过
    try {
      const srcStat = statSync(srcPath);
      const dstStat = statSync(dstPath);
      if (dstStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
    } catch (_) {
      /* AVIF 不存在，正常转换 */
    }

    try {
      const srcSize = statSync(srcPath).size;
      await sharp(srcPath)
        .avif({ quality: 65, effort: 4, chromaSubsampling: "4:2:0" })
        .toFile(dstPath);
      const dstSize = statSync(dstPath).size;
      const ratio = srcSize > 0 ? ((1 - dstSize / srcSize) * 100).toFixed(0) : "?";
      console.log(`AVIF: ${fname} → ${avifName}  ${(srcSize / 1024).toFixed(0)}KB → ${(dstSize / 1024).toFixed(0)}KB (${ratio}%)`);
      converted++;
    } catch (e) {
      console.error(`AVIF FAIL: ${fname} — ${e.message}`);
      errors++;
    }
  }

  console.log(`\nAVIF done: ${converted} converted, ${skipped} skipped, ${errors} errors (${files.length} total in img/)`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error("AVIF fatal:", e);
  process.exit(1);
});
