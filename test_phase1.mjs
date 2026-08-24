import { validateTitle, cleanTitleDeterministic, toTitleCaseSmart, getTitleDisplay } from "./src/lib/titleValidator.ts";

function run(label, title) {
  console.log(`\n=== ${label} ===`);
  console.log(`Input: "${title}" (${[...title].length} chars)`);
  const v = validateTitle(title);
  console.log(`Valid: ${v.valid}, Length: ${v.length}`);
  console.log(`Violations:`, v.violations.map(x=>`${x.type}:${x.message}`).join(" | ") || "none");
  console.log(`Display:`, getTitleDisplay(title));
  console.log(`Cleaned: "${cleanTitleDeterministic(title)}" (${[...cleanTitleDeterministic(title)].length})`);
  console.log(`TitleCaseSmart: "${toTitleCaseSmart(title)}"`);
}

// Test 1: normal
run("Test1 正常标题", "Waterproof Bluetooth Speaker, IP67, 360-degree sound, portable design");
// Test 2: over 75
run("Test2 超长", "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties");
// Test 3: ALL CAPS
run("Test3 ALL CAPS", "WATERPROOF BLUETOOTH SPEAKER IP67");
// Test 4: promotional
run("Test4 促销词", "Best Amazing Waterproof Bluetooth Speaker #1");
// Test 5: Markdown/Emoji
run("Test5 Markdown/Emoji", "**Waterproof** 🔥 Bluetooth Speaker");
// Test 6: repeated
run("Test6 重复词", "Bluetooth Bluetooth Waterproof Speaker Speaker");
// Test 7: empty
run("Test7 空标题", "");
// Test 8: special char
run("Test8 特殊字符", "Waterproof!!! Bluetooth Speaker ### IP67");

// Additional checks
console.log("\n=== TitleCase 特殊 token ===");
console.log(toTitleCaseSmart("WATERPROOF BLUETOOTH SPEAKER IP67"));
console.log(toTitleCaseSmart("waterproof bluetooth speaker ip67"));
console.log(toTitleCaseSmart("360° surround sound speaker"));
console.log(toTitleCaseSmart("IP67 Waterproof Bluetooth Speaker for Outdoor Use"));

console.log("\n=== Cleaning 不会增加长度 ===");
const long = "Waterproof Bluetooth Speaker with 360-Degree Surround Sound and Ultra Long Battery Life for Outdoor Adventures and Indoor Parties";
console.log("Before", [...long].length, "After", [...cleanTitleDeterministic(long)].length);
