#!/usr/bin/env node
/**
 * 构建 dsh-provider-pool 的浏览器半边：
 *   - app/panel.js  → gzip + base64 内嵌进 lib/client.js
 *   - lib/client.template.js → lib/client.js（把占位符替换成上面的 payload）
 *
 * 面板是「React 直接渲染」：client.js 解压这段源码后用 new Function("react", code)
 * 执行，拿到 { ProviderPanel }，不需要 iframe、不需要额外前端依赖、不需要打包器。
 *
 * 用法：node build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const panelPath = path.join(here, "app", "panel.js");
const templatePath = path.join(here, "lib", "client.template.js");
const outPath = path.join(here, "lib", "client.js");

for (const file of [panelPath, templatePath]) {
  if (!fs.existsSync(file)) {
    console.error(`缺少源文件：${file}`);
    process.exit(1);
  }
}

const panelSource = fs.readFileSync(panelPath, "utf8");
const template = fs.readFileSync(templatePath, "utf8");

const PLACEHOLDER = "var PANEL_GZIP_B64 = __PANEL_GZIP_B64__;";
if (!template.includes(PLACEHOLDER)) {
  console.error(`模板里找不到占位符：${PLACEHOLDER}`);
  process.exit(1);
}

// 先校验面板源码语法（在 Node 里也能编译；执行时才注入 react）。
try {
  // eslint-disable-next-line no-new-func
  new Function("react", panelSource);
} catch (error) {
  console.error(`app/panel.js 语法错误：${error.message}`);
  process.exit(1);
}

const panelB64 = zlib.gzipSync(Buffer.from(panelSource, "utf8"), { level: 9 }).toString("base64");
const client = template.replace(PLACEHOLDER, `var PANEL_GZIP_B64 = ${JSON.stringify(panelB64)};`);

// 占位符必须全部替换干净，避免把未构建的模板发布出去。
if (/\bvar\s+[A-Z0-9_]+\s*=\s*__[A-Z0-9_]+__\s*;/.test(client)) {
  console.error("lib/client.js 里仍残留未替换的占位符，构建中止");
  process.exit(1);
}

fs.writeFileSync(outPath, client);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`panel.js   ${kb(Buffer.byteLength(panelSource))} → gzip ${kb(Buffer.byteLength(panelB64, "base64"))} (base64)`);
console.log(`client.js  ${kb(Buffer.byteLength(client))} -> ${path.relative(here, outPath)}`);
console.log("build ok");
