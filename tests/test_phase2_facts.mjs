import { validateFacts } from "../src/lib/factValidator.ts";

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function run() {
  let pass = 0;
  let fail = 0;

  // Test 1: 版本号捏造拦截
  {
    const facts = ["蓝牙"];
    const text = "This speaker features Bluetooth 5.0 for stable connection.";
    const res = validateFacts(text, facts);
    const ok = res.some((r) => r.type === "UNSUPPORTED_VERSION" && r.value.toLowerCase().includes("bluetooth 5.0"));
    console.log(`Test 1 版本号捏造: ${ok ? "PASS" : "FAIL"}`, res);
    ok ? pass++ : fail++;
  }

  // Test 2: 数值捏造拦截
  {
    const facts = ["长续航"];
    const text = "Enjoy 24 hours playtime without charging.";
    const res = validateFacts(text, facts);
    const ok = res.some((r) => r.type === "UNSUPPORTED_NUMBER" && r.value.toLowerCase().includes("24"));
    console.log(`Test 2 数值捏造: ${ok ? "PASS" : "FAIL"}`, res);
    ok ? pass++ : fail++;
  }

  // Test 3: 合法放行
  {
    const facts = ["IP67", "360°"];
    const text = "IP67 rated enclosure with 360° sound for immersive experience.";
    const res = validateFacts(text, facts);
    const ok = res.length === 0;
    console.log(`Test 3 合法放行: ${ok ? "PASS" : "FAIL"}`, res);
    ok ? pass++ : fail++;
  }

  // Test 4: 白名单豁免
  {
    const facts = ["防水"];
    const text = "100% waterproof design for outdoor use.";
    const res = validateFacts(text, facts);
    const ok = res.length === 0;
    console.log(`Test 4 白名单: ${ok ? "PASS" : "FAIL"}`, res);
    ok ? pass++ : fail++;
  }

  console.log(`\nResult: ${pass}/4 PASS, ${fail}/4 FAIL`);
  if (fail > 0) process.exit(1);
}

run();
