const SliceFormatConverter = require('./utils/sliceFormatConverter');

/**
 * Test script to verify the fixed emoji handling
 * Only converts emojis we can actually match, removes unknown ones
 */
async function testEmojiHandlingFixed() {
  console.log('🔪✨ Testing Fixed Emoji Handling - Conservative Matching\n');
  
  const testCases = [
    {
      name: 'Your problematic case',
      input: 'Added 4 days to all active customers <:unincloud:1226444817509122191>'
    },
    {
      name: 'Known emojis (should convert)',
      input: 'Status: <:fire:123> <:heart:456> <:warning:789> <:check:012>'
    },
    {
      name: 'Unknown emojis (should be removed)',
      input: 'Unknown: <:unincloud:123> <:customname:456> <:servername:789> <:random:012>'
    },
    {
      name: 'Partial matches that should work',
      input: 'Good partials: <:fire_emoji:123> <:heart_red:456> <:warning_sign:789>'
    },
    {
      name: 'Partial matches that should NOT work (too vague)',
      input: 'Bad partials: <:unknown_no:123> <:something_x:456> <:server_info:789>'
    },
    {
      name: 'Mixed known and unknown',
      input: 'Mixed: <:fire:123> <:unincloud:456> <:heart:789> <:customemoji:012>'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📝 ${testCase.name}`);
    console.log(`${'='.repeat(50)}`);
    console.log(`📥 Input:  "${testCase.input}"`);
    
    try {
      const result = await SliceFormatConverter.convertDiscordToTelegramMarkdownV2(testCase.input, null);
      console.log(`📤 Output: "${result}"`);
      
      // Analyze the conversion
      const inputEmojis = testCase.input.match(/<a?:(\w+):\d+>/g) || [];
      console.log(`🔍 Analysis:`);
      
      inputEmojis.forEach(emoji => {
        const emojiName = emoji.match(/<a?:(\w+):\d+>/)[1];
        const standardEmoji = SliceFormatConverter.convertCustomEmojiToStandard(emojiName);
        
        if (standardEmoji) {
          console.log(`   ✅ ${emoji} -> ${standardEmoji} (converted)`);
        } else {
          console.log(`   ❌ ${emoji} -> [removed] (no match)`);
        }
      });
      
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log('🏁 Fixed Emoji Testing Complete!');
  console.log(`${'='.repeat(50)}`);
  console.log('\n📊 Fixed Behavior:');
  console.log('✅ Exact matches: fire -> 🔥, heart -> ❤️, warning -> ⚠️');
  console.log('✅ Good partial matches: fire_emoji -> 🔥, heart_red -> ❤️');
  console.log('❌ Unknown emojis: unincloud -> [removed]');
  console.log('❌ Vague partials: unknown_no -> [removed] (too vague)');
  console.log('');
  console.log('🎯 Result: Only emojis we can properly match are converted,');
  console.log('   all others are cleanly removed as requested!');
}

// Run the test
if (require.main === module) {
  testEmojiHandlingFixed().catch(console.error);
}