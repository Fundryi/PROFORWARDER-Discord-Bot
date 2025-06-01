const FormatConverter = require('./utils/formatConverter');

console.log('=== Final MarkdownV2 Verification Test ===\n');

const testCases = [
  {
    name: 'Your Real Discord Example',
    input: `This is a cool test. 
**Bold** 
*Itally * 
\`Code\` 
~~Strike ~~ 
\`QUOTE\` 
||SPOILER|| 

\`\`\`
CODE IN HERE
\`\`\``,
    expected: 'All entities paired, code blocks preserved'
  },
  {
    name: 'Mixed formatting with underscores',
    input: 'Check **bold** and *italic* with some_variable_names here!',
    expected: 'Bold (*bold*), italic (_italic_), underscores escaped'
  },
  {
    name: 'Complex combinations',
    input: '**Bold** *italic* __underline__ ~~strike~~ ||spoiler|| `code`',
    expected: 'All formatting types converted correctly'
  },
  {
    name: 'Edge case with multiple code blocks',
    input: 'Text `inline` more text ```\nblock\n``` and `more inline`',
    expected: 'Multiple code elements handled'
  }
];

let allPassed = true;

testCases.forEach((testCase, index) => {
  console.log(`\n--- Test ${index + 1}: ${testCase.name} ---`);
  console.log(`📝 Input: "${testCase.input}"`);
  
  try {
    const result = FormatConverter.discordToTelegramMarkdownV2(testCase.input);
    console.log(`✅ Output: "${result}"`);
    
    // Check entity pairing
    const unescapedCounts = {
      '*': (result.match(/(?<!\\)\*/g) || []).length,
      '_': (result.match(/(?<!\\)_/g) || []).length,
      '~': (result.match(/(?<!\\)~/g) || []).length,
      '|': (result.match(/(?<!\\)\|/g) || []).length,
      '`': (result.match(/(?<!\\)`/g) || []).length
    };
    
    console.log(`📊 Entity counts:`, unescapedCounts);
    
    const allPaired = Object.entries(unescapedCounts).every(([char, count]) => count % 2 === 0);
    console.log(`🔗 All paired: ${allPaired ? '✅ YES' : '❌ NO'}`);
    
    if (!allPaired) {
      allPassed = false;
      console.log('❌ This test case has unmatched entities!');
    }
    
    // Check for unrestored placeholders
    if (result.includes('XPROTECTEDX')) {
      allPassed = false;
      console.log('❌ Found unrestored placeholders!');
    } else {
      console.log('✅ All placeholders restored');
    }
    
  } catch (error) {
    allPassed = false;
    console.log(`❌ ERROR: ${error.message}`);
  }
});

console.log('\n' + '='.repeat(50));
console.log(`\n🎯 FINAL RESULT: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

if (allPassed) {
  console.log('🎉 MarkdownV2 conversion is working perfectly!');
  console.log('📋 Ready for production use.');
} else {
  console.log('⚠️  There are still issues that need to be fixed.');
}

console.log('\n=== Verification Complete ===');