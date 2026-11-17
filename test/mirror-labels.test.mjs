import assert from "node:assert/strict"
import { test } from "node:test"
import { format, LOCALES } from "../src/labels.mjs"

test("Korean mirror messages choose the particle from the place name", () => {
  const message = LOCALES.ko.messages["mirror-recent"]
  assert.match(format(message, { place: "홈", minutes: 2 }), /^홈이 최근 2분/)
  assert.match(format(message, { place: "메모", minutes: 2 }), /^메모가 최근 2분/)
  assert.match(format(message, { place: "Home", minutes: 2 }), /^Home: 최근 2분/)
  assert.match(format(message, { place: "홈", minutes: 2 }), /^홈이 최근 2분/)
  for (const [suffix, consonant, vowel] of [["를", "을", "를"], ["는", "은", "는"], ["와", "과", "와"]]) {
    assert.equal(format(`{place}${suffix} 함께`, { place: "홈" }), `홈${consonant} 함께`)
    assert.equal(format(`{place}${suffix} 함께`, { place: "메모" }), `메모${vowel} 함께`)
    assert.equal(format(`{place}${suffix} 함께`, { place: "Home" }), "Home: 함께")
  }
  assert.equal(format("{place}가 최근", {}), "{place}가 최근")
  assert.equal(format("{name}이어야 합니다", { name: "sample" }), "sample이어야 합니다")
})
