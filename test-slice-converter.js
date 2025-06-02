const FormatConverter = require('./utils/formatConverter');
const AIFormatConverter = require('./utils/aiFormatConverter');
const SliceFormatConverter = require('./utils/sliceFormatConverter');

/**
 * Test script to demonstrate the three different formatting approaches
 */
async function testFormatConverters() {
  console.log('🧪 Testing Format Converters - Three Different Approaches\n');
  
  // Test cases that demonstrate the slice-based approach
  const testCases = [
    {
      name: 'Bold text with special characters',
      input: '**Genshin Impact | Update 26.05**'
    },
    {
      name: 'Mixed formatting',
      input: '**Bold** and *italic* and ~~strikethrough~~'
    },
    {
      name: 'Code blocks and inline code',
      input: 'Here is `inline code` and:\n```javascript\nconsole.log("hello");\n```'
    },
    {
      name: 'Complex bullet list',
      input: '- Removed `Rapidfire`, feature will be moved to "Unsafe mode" later\n- Removed `Uid Changer`\n- Installed **overall security update**. (СN / Europe / Asia builds)'
    },
    {
      name: 'Headings',
      input: '# Main Title\n## Subtitle\n### Small heading\n#### Very small'
    },
    {
      name: 'Mixed complex formatting',
      input: '**Welcome to our server!**\n\n### 🌟 Features:\n- **Bold text** with *emphasis*\n- `Code snippets`\n- ||Spoiler content||\n\n> This is a quote'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 Test Case: ${testCase.name}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📥 Input: "${testCase.input}"`);
    console.log(`${'-'.repeat(60)}`);
    
    try {
      // Method 1: Regular conversion (old way)
      console.log('⚙️  Method 1 - Regular Conversion (Old Way):');
      const regularResult = FormatConverter.discordToTelegramMarkdownV2(testCase.input);
      console.log(`"${regularResult}"`);
      console.log();
      
      // Method 3: Slice-based conversion (new hybrid way)
      console.log('🔪 Method 3 - Slice-Based Conversion (New Hybrid Way):');
      const sliceResult = await SliceFormatConverter.convertDiscordToTelegramMarkdownV2(testCase.input);
      console.log(`"${sliceResult}"`);
      console.log();
      
      // Show slice breakdown for educational purposes
      console.log('🔍 Slice Breakdown:');
      const slices = SliceFormatConverter.parseTextIntoSlices(testCase.input);
      slices.forEach((slice, index) => {
        console.log(`  Slice ${index + 1}: [${slice.type}] "${slice.content}"`);
      });
      
      // Compare results
      console.log('\n🔄 Comparison:');
      if (regularResult === sliceResult) {
        console.log('✅ Results are identical');
      } else {
        console.log('❗ Results differ:');
        console.log(`   Regular:     "${regularResult}"`);
        console.log(`   Slice-based: "${sliceResult}"`);
      }
      
    } catch (error) {
      console.error(`❌ Error in test case "${testCase.name}":`, error.message);
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('🏁 Testing Complete!');
  console.log(`${'='.repeat(60)}`);
  console.log('\n📊 Summary of the Three Approaches:');
  console.log('⚙️  Method 1 (Regular): Direct code conversion - fast but limited');
  console.log('🤖 Method 2 (AI): Uses AI to handle complex cases - smart but slower');
  console.log('🔪 Method 3 (Slice): Breaks text into slices, converts each - hybrid approach');
  console.log('\n💡 The slice-based approach provides:');
  console.log('   • 1:1 precision for each formatting element');
  console.log('   • Better handling of complex mixed formatting');
  console.log('   • Predictable and debuggable conversion process');
  console.log('   • No dependency on AI but still handles edge cases');
}

// Configuration demo
function showConfigurationOptions() {
  console.log('\n⚙️  Configuration Options in config/env.js:');
  console.log('');
  console.log('// Choose your formatting approach:');
  console.log('useAIFormatConverter: false,    // Method 2: AI-powered conversion');
  console.log('useSliceFormatConverter: true,  // Method 3: Slice-based conversion (NEW)');
  console.log('');
  console.log('// Priority order: Slice-based > AI > Regular');
  console.log('// - If slice-based is enabled, it will be used first');
  console.log('// - If slice-based fails, fallback to AI (if enabled)');
  console.log('// - If both fail or are disabled, use regular conversion');
}

// Run the tests
if (require.main === module) {
  testFormatConverters().then(() => {
    showConfigurationOptions();
  }).catch(console.error);
}

module.exports = { testFormatConverters };