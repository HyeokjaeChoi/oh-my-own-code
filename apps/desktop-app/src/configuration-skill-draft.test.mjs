import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  validSkillSourceName,
  skillFileContentFits,
  validateSkillFile,
  skillFileWriteFits,
} from "./renderer/shared/configuration-draft/skill.mjs";

test("Skill files: exact safe folder names and inert closed Markdown grammar", () => {
  assert.equal(validSkillSourceName("example-skill_2"), true);
  for (const name of [
    "../escape",
    "UPPER",
    "a/b",
    "",
    "_hidden",
    "x".repeat(65),
  ])
    assert.equal(validSkillSourceName(name), false);
  for (const text of [
    "# Skill\n한국어 😀\n",
    '\uFEFF---\nname: "한국어"\ndescription: "A small skill"\nmetadata:\n  opencode/autoinvoke: false\n---\n# Body\n',
  ]) {
    assert.equal(skillFileContentFits(text), true);
    assert.equal(validateSkillFile(text).status, "valid");
    assert.equal(skillFileWriteFits(text), true);
  }
  for (const text of [
    "---\nname: plain YAML\n---\nbody",
    '---\nname: "a"\nname: "b"\n---\nbody',
    '---\nother: "x"\n---\nbody',
    "---\nmetadata:\n  opencode/autoinvoke: !!bool true\n---\nbody",
    '---\nname: "a"\n---\n   ',
  ]) {
    assert.equal(
      skillFileContentFits(text),
      true,
      "safe unsupported original remains readable",
    );
    assert.notEqual(validateSkillFile(text).status, "valid");
    assert.equal(skillFileWriteFits(text), false);
  }
  for (const text of ["\u0000", "\uD800", "x".repeat(32769)])
    assert.equal(skillFileContentFits(text), false);
});
test("supported Skill frontmatter agrees with the actual pinned inert parser", async () => {
  const path =
    "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-0bywbddq.js";
  const repository = new URL("../../../", import.meta.url);
  const facts = JSON.parse(
    await readFile(
      new URL(
        "docs/runs/configuration-skill-files/source-facts.json",
        repository,
      ),
      "utf8",
    ),
  );
  const parserURL = new URL(path, repository);
  assert.equal(
    createHash("sha256")
      .update(await readFile(parserURL))
      .digest("hex"),
    facts.sources[path],
  );
  const { parse2 } = await import(parserURL.href);
  for (const newline of ["\n", "\r\n"]) {
    const body = "# Synthetic body" + newline;
    const text =
      "\uFEFF" +
      [
        "---",
        'name: "한국어 😀"',
        'description: "Small: inert example"',
        "metadata:",
        "  opencode/autoinvoke: false",
        "---",
        "# Synthetic body",
        "",
      ].join(newline);
    assert.equal(skillFileWriteFits(text), true);
    const parsed = parse2(
      "/synthetic/.opencode/skills",
      "/synthetic/.opencode/skills/small-skill/SKILL.md",
      text,
    );
    assert.equal(parsed._tag, "Parsed");
    assert.equal(parsed.skill.id, "small-skill");
    assert.equal(parsed.skill.name, "한국어 😀");
    assert.equal(parsed.skill.autoinvoke, false);
    assert.equal(parsed.skill.content, body);
  }
});
