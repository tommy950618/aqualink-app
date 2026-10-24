#!/usr/bin/env node
/* Build the claude.ai Artifact page from index.html.
 *   node tools/build-artifact.js
 * Writes dist/index.html: index.html minus the document skeleton (<!doctype>, <html>, <head>, <body>),
 * which the Artifact host adds itself. Prints the `files` map (published path -> source) for the
 * supporting scripts/styles referenced by the page.
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

var out = html
  .replace(/<!doctype[^>]*>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/\s*<\/html>\s*$/i, '\n')
  .replace(/<head[^>]*>\s*/i, '')
  .replace(/\s*<\/head>\s*/i, '\n')
  .replace(/<body[^>]*>\s*/i, '')
  .replace(/\s*<\/body>\s*/i, '\n')
  // the host skeleton already provides charset; keep our viewport meta (it disables zoom)
  .replace(/<meta charset="utf-8">\s*/i, '');

// Plain Google Fonts link (no inline onload handler), and inline our own stylesheet.
out = out
  .replace(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)" media="print" onload="[^"]*">/,
    '<link rel="stylesheet" href="$1">')
  .replace(/<noscript>[\s\S]*?<\/noscript>\s*/i, '')
  .replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, function (_, u) {
    return '<style>\n' + fs.readFileSync(path.join(ROOT, u), 'utf8') + '\n</style>';
  });

// Title must be near the top of the file.
var t = out.match(/<title>[^<]*<\/title>\s*/i);
if (t) out = t[0].trim() + '\n' + out.replace(t[0], '');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), out);

var refs = [];
out.replace(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g, function (_, u) {
  if (!/^(https?:|data:|\/\/)/.test(u)) refs.push(u);
});
var files = {};
refs.forEach(function (u) {
  var src = path.join(ROOT, u);
  if (!fs.existsSync(src)) throw new Error('missing referenced file ' + u);
  files[u] = path.relative(process.cwd(), src);
});
var total = Buffer.byteLength(out) + refs.reduce(function (s, u) { return s + fs.statSync(path.join(ROOT, u)).size; }, 0);
console.log(JSON.stringify(files, null, 2));
console.error('dist/index.html written; ' + refs.length + ' supporting files; total ' + (total / 1024).toFixed(0) + ' KB');
