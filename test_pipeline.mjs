import { validateTitle, cleanTitleDeterministic } from "./src/lib/titleValidator.ts";

// Mock pipeline logic extracted from App.tsx
async function runPipeline(initialTitle, mockFetch) {
  let parsed = { title: initialTitle, bullets: ["a","b","c","d","e"] };
  let result = null;
  let error = null;

  const initialValidation = validateTitle(parsed.title);
  const overLength = initialValidation.violations.some(v => v.type === "OVER_LENGTH");
  
  if (!parsed.title || initialValidation.violations.some(v => v.type === "EMPTY")) {
    error = "标题为空";
    return { result, error, fetchCalls: 0 };
  }

  if (overLength) {
    const cleaned = cleanTitleDeterministic(parsed.title);
    const cleanedValidation = validateTitle(cleaned);
    if (cleaned.length <= 75 && cleanedValidation.valid) {
      parsed = { ...parsed, title: cleaned };
      result = parsed;
      return { result, error, fetchCalls: 0 };
    } else {
      let lastTitle = parsed.title;
      let success = false;
      let fetchCalls = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          fetchCalls++;
          const compressed = await mockFetch(lastTitle, attempt);
          const compCleaned = cleanTitleDeterministic(compressed);
          const compV = validateTitle(compCleaned);
          if (compCleaned.length <= 75 && compV.valid) {
            parsed = { ...parsed, title: compCleaned };
            result = parsed;
            success = true;
            break;
          }
          lastTitle = compCleaned;
        } catch (e) {
          error = `Compression attempt ${attempt+1} failed`;
          break;
        }
      }
      if (!success) {
        error = "Title generation failed / Please regenerate - 标题超过75字符且压缩失败，请点击重新生成";
        return { result: null, error, fetchCalls };
      }
      return { result, error, fetchCalls };
    }
  } else if (!initialValidation.valid) {
    parsed = { ...parsed, title: cleanTitleDeterministic(parsed.title) };
    result = parsed;
    return { result, error, fetchCalls: 0 };
  } else {
    result = parsed;
    return { result, error, fetchCalls: 0 };
  }
}

async function test() {
  console.log("=== Pipeline Test A: First >75, second <=75 ===");
  let callsA = 0;
  const resA = await runPipeline(
    "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties", // 129
    async (title, attempt) => {
      callsA++;
      if (attempt === 0) return "Waterproof Bluetooth Speaker for Outdoor Use"; // 42, valid
      return "Should not be called";
    }
  );
  console.log(`Fetch calls: ${callsA}, Result: ${resA.result ? `"${resA.result.title}" (${[...resA.result.title].length})` : "null"}, Error: ${resA.error}`);
  console.log(resA.result && [...resA.result.title].length <=75 && !resA.error ? "PASS" : "FAIL");

  console.log("\n=== Pipeline Test B: First >75, second >75, third >75 ===");
  const resB = await runPipeline(
    "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties",
    async () => "This Is Still A Very Long Title That Exceeds Seventy Five Characters For Sure And Will Fail Again"
  );
  console.log(`Fetch calls: ${resB.fetchCalls}, Result: ${resB.result}, Error: ${resB.error}`);
  console.log(resB.fetchCalls === 2 && !resB.result && resB.error?.includes("Please regenerate") ? "PASS" : "FAIL");

  console.log("\n=== Pipeline Test C: First <=75 but warning (promotional) ===");
  const resC = await runPipeline(
    "Best Amazing Waterproof Bluetooth Speaker #1",
    async () => { throw new Error("Should not be called"); }
  );
  console.log(`Result: "${resC.result?.title}", Error: ${resC.error}, FetchCalls: ${resC.fetchCalls}`);
  console.log(resC.result && resC.fetchCalls === 0 && !resC.error ? "PASS (not trigger compression, warning only)" : "FAIL");

  console.log("\n=== Pipeline Test D: Compression API error ===");
  const resD = await runPipeline(
    "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties",
    async () => { throw new Error("Network error"); }
  );
  console.log(`Result: ${resD.result}, Error: ${resD.error}`);
  console.log(!resD.result && resD.error ? "PASS" : "FAIL");

  console.log("\n=== Pipeline Test E: Malformed JSON (simulated by empty content) ===");
  // Simulate malformed by returning empty string which will be treated as valid after clean? For this test, we simulate fetch throwing due to JSON parse error
  const resE = await runPipeline(
    "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties",
    async () => { throw new Error("JSON parse error"); }
  );
  console.log(`Result: ${resE.result}, Error: ${resE.error}`);
  console.log(!resE.result && resE.error ? "PASS" : "FAIL");

  console.log("\n=== Special Char Clean Test ===");
  const special = "Waterproof!!! Bluetooth Speaker ### IP67";
  const cleaned = cleanTitleDeterministic(special);
  const vAfter = validateTitle(cleaned);
  console.log(`Before: "${special}" After: "${cleaned}" Valid: ${vAfter.valid} Violations: ${vAfter.violations.length}`);
  console.log(cleaned === "Waterproof Bluetooth Speaker IP67" && vAfter.valid ? "PASS" : "FAIL");

  console.log("\n=== Empty Test ===");
  const emptyRes = await runPipeline("", async () => "should not");
  console.log(`Result: ${emptyRes.result}, Error: ${emptyRes.error}`);
  console.log(!emptyRes.result && emptyRes.error?.includes("为空") ? "PASS" : "FAIL");
}

test();
