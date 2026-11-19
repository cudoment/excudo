import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { READMES } from "../scripts/ranges.mjs"

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
const manifest = JSON.parse(read("package.json"))

test("every README ships in the package and links the other three in a language line", () => {
  for (const file of READMES) {
    assert.ok(manifest.files.includes(file), `${file} is in package.json files`)
    const top = read(file).split("\n").slice(0, 6).join("\n")
    for (const other of READMES.filter((name) => name !== file)) assert.ok(top.includes(`(${other})`), `${file} links ${other} near the top`)
  }
})
test("no README holds a dot, bracket, numeral or dash that reads as machine-written", () => {
  for (const file of READMES) assert.deepEqual(read(file).match(/[·・ㆍ•∙「-』①-⑳⑴-⒇—]/g) ?? [], [], file)
})
test("the agent install rules agree in all four READMEs", () => {
  for (const file of READMES) {
    const text = read(file)
    assert.match(text, /npx -y excudo@\^\d+\.\d+\.\d+ init <(?:folder|폴더)> --locale (?:<(?:language|언어)>|en)/, `${file} runs init with a locale`)
    assert.match(text, /cd <(?:folder|폴더)> && npm install && git init && npx --no-install excudo start --report --json/, `${file} runs the report line`)
    for (const step of ["workspace", "install", "git", "skills"]) assert.match(text, new RegExp(`\`${step}\``), `${file} names ${step}`)
    assert.match(text, /stoppedAt/, file)
  }
  for (const file of ["README.ja.md", "README.zh-CN.md"]) {
    const text = read(file)
    assert.match(text, new RegExp(`following its ${file.replaceAll(".", "\\.")} section "`), `${file} names itself in the paste sentence`)
    assert.match(text, /--locale en/, `${file} installs with en`)
  }
})
