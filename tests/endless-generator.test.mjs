import assert from "node:assert/strict";
import test from "node:test";

import { ENDLESS_ROOM_TEMPLATES, generateEndlessRoom, templateIndexFor } from "../app/endless-generator.ts";

test("endless room generation is deterministic and uses authored templates", () => {
  assert.equal(ENDLESS_ROOM_TEMPLATES.length, 15);
  assert.deepEqual(generateEndlessRoom(41721, 37, "adventure"), generateEndlessRoom(41721, 37, "adventure"));
  assert.notDeepEqual(generateEndlessRoom(41721, 37, "adventure"), generateEndlessRoom(41722, 37, "adventure"));
});

test("a thousand generated rooms remain connected and avoid recent repeats", () => {
  const recent = [];
  for (let index = 0; index < 1000; index += 1) {
    const template = templateIndexFor(8128, index);
    assert.ok(!recent.includes(template));
    recent.push(template);
    if (recent.length > 3) recent.shift();
    const room = generateEndlessRoom(8128, index, "expert");
    assert.ok(room.platforms.some((platform) => platform.x === index * 960 && platform.y === 480 && platform.width === 960));
    assert.ok(room.spawns.length <= 8);
  }
});

test("five-room pacing inserts havens and every tenth combat peak is a guardian", () => {
  assert.equal(generateEndlessRoom(1, 5, "adventure").haven, true);
  assert.equal(generateEndlessRoom(1, 9, "adventure").boss, true);
  assert.equal(generateEndlessRoom(1, 9, "adventure").spawns[0].kind, "guardian");
  assert.equal(generateEndlessRoom(1, 10, "adventure").haven, true);
});
