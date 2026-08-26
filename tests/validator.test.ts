import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateTitle,
  cleanTitleDeterministic,
  toTitleCaseSmart,
  containsSpecialChar,
  validateHighlights,
  cleanHighlightsDeterministic,
} from "../src/lib/titleValidator.ts";
import { validateFacts } from "../src/lib/factValidator.ts";
import { validateBullets } from "../src/lib/bulletValidator.ts";

describe("titleValidator", () => {
  test("正常标题通过", () => {
    const v = validateTitle("34 oz Insulated Water Bottle for Hiking");
    assert.equal(v.valid, true);
    assert.equal(v.violations.length, 0);
  });

  test("超长标题报 OVER_LENGTH", () => {
    const long = "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties";
    const v = validateTitle(long);
    assert.ok(v.violations.some((x) => x.type === "OVER_LENGTH"));
  });

  test("全大写报 ALL_CAPS", () => {
    const v = validateTitle("WATERPROOF BLUETOOTH SPEAKER IP67");
    assert.ok(v.violations.some((x) => x.type === "ALL_CAPS"));
  });

  test("空标题报 EMPTY", () => {
    const v = validateTitle("");
    assert.ok(v.violations.some((x) => x.type === "EMPTY"));
  });

  test("B1 计量单位不被打成全大写", () => {
    assert.equal(toTitleCaseSmart("max 5000mah battery"), "Max 5000mah Battery");
    assert.equal(toTitleCaseSmart("max 368mAh battery"), "Max 368mAh Battery");
  });

  test("B1 已规范 Title 不被破坏", () => {
    assert.equal(toTitleCaseSmart("IP67 Waterproof Bluetooth Speaker"), "IP67 Waterproof Bluetooth Speaker");
  });

  test("B2 逐处豁免：一个>3不放行其他裸<>", () => {
    const v = containsSpecialChar(">3lb heavy duty ><");
    assert.ok(v.includes("<>"));
  });

  test("B2 逐处豁免：Style#131不放行其他裸#", () => {
    const v = containsSpecialChar("Style #131 zebra #bad");
    assert.ok(v.includes("#"));
  });

  test("B2 合法上下文不误报", () => {
    assert.deepEqual(containsSpecialChar("Style #131"), []);
    assert.deepEqual(containsSpecialChar("60~80 volt"), []);
  });

  test("B3 乱序大写被规范化", () => {
    assert.equal(cleanTitleDeterministic("waterPROOF bluetooth SPEAKER"), "Waterproof Bluetooth Speaker");
  });

  test("clean 条件字符逐处处理：合法保留、裸符号删除", () => {
    assert.equal(cleanTitleDeterministic("Style #131 zebra #bad"), "Style #131 zebra bad");
    assert.equal(cleanTitleDeterministic(">3lb heavy duty ><"), ">3lb heavy duty");
    assert.equal(cleanTitleDeterministic("Waterproof ### Speaker"), "Waterproof Speaker");
  });

  test("clean 不增加长度", () => {
    const long = "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties";
    const out = cleanTitleDeterministic(long);
    assert.ok([...out].length <= [...long].length);
  });

  test("highlights 清理与条件字符一致", () => {
    assert.equal(cleanHighlightsDeterministic("Waterproof # Speaker"), "Waterproof Speaker");
  });
});

describe("factValidator 防幻觉", () => {
  test("版本号捏造拦截", () => {
    const res = validateFacts("This speaker features Bluetooth 5.0.", ["蓝牙"]);
    assert.ok(res.some((r) => r.type === "UNSUPPORTED_VERSION"));
  });

  test("数值捏造拦截", () => {
    const res = validateFacts("Enjoy 24 hours playtime.", ["长续航"]);
    assert.ok(res.some((r) => r.type === "UNSUPPORTED_NUMBER"));
  });

  test("合法放行", () => {
    assert.deepEqual(validateFacts("IP67 rated with 360° sound.", ["IP67", "360°"]), []);
  });
});

describe("bulletValidator", () => {
  test("合规五点", () => {
    const r = validateBullets([
      "IP67 WATERPROOF DESIGN: Sealed housing resists splashes and rain for outdoor use",
      "LONG BATTERY LIFE: Up to 12 hours playtime per charge, lasts through extended trips",
      "PORTABLE FORM: Compact and lightweight, easy to carry in a backpack or handbag",
      "HANDSFREE CALLS: Built-in microphone enables clear calls without taking out the phone",
      "QUICK CHARGE: USB-C port refills battery in under 2 hours for less downtime",
    ]);
    assert.equal(r.totalLength > 0, true);
  });

  test("过短报 TOO_SHORT", () => {
    const r = validateBullets(["short"]);
    assert.ok(r.bulletResults[0].violations.some((x) => x.type === "TOO_SHORT"));
  });
});
