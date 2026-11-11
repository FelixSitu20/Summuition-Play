"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const landing = fs.readFileSync("guest/index.html", "utf8");
const player = fs.readFileSync("guest/game/index.html", "utf8");
const css = html => html.match(/<style>([\s\S]*?)<\/style>/)[1];
for (const html of [landing, player]) {
  const style = css(html);
  for (const color of ["#303134", "#3b3d40", "#d4d0c6", "#a4a7aa", "#bcb5a6", "#303236"]) assert.ok(style.includes(color), color);
  assert.doesNotMatch(style, /#(?:121213|1d1d1e|f2eee4|fffaf0|b8bcc1|aaa9a6|29292b)\b/i);
  assert.match(style, /font-family:Beholden/);
  assert.match(style, /data:font\/ttf;base64,/);
  assert.match(style, /data:image\/png;base64,/);
}
assert.match(landing, /background:#bcb5a6;color:#303236/);
assert.match(landing, /\.play:hover\{background:#d4d0c6\}/);
assert.match(player, /button:hover\{background:#bcb5a6;color:#303236\}/);
assert.match(player, /#player:fullscreen #fullscreen\{background:#3b3d40ed\}/);
assert.match(player, /canvas\{[^}]*background:#303134/);
assert.match(player, /#status\{[^}]*background:#303134/);
function luminance(hex) {
  const rgb = hex.match(/\w\w/g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
for (const [foreground, background] of [["d4d0c6","303134"],["d4d0c6","3b3d40"],["a4a7aa","303134"],["a4a7aa","3b3d40"],["303236","bcb5a6"]]) {
  const values = [luminance(foreground), luminance(background)].sort((a,b) => b-a);
  assert.ok((values[0]+.05)/(values[1]+.05) >= 4.5, `${foreground} on ${background}`);
}
console.log("PASS: softer wrapper/landing palette, retained font/artwork, fullscreen backdrop, hover ink and >=4.5:1 text contrast.");
