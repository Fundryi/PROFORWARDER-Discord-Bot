const SliceFormatConverterEnhanced = require('./utils/sliceFormatConverterEnhanced');
const SliceFormatConverter = require('./utils/sliceFormatConverter');
const FormatConverter = require('./utils/formatConverter');

/**
 * Test script to demonstrate the enhanced slice-based converter
 * with smart mention resolution and Discord emoji handling
 */
async function testEnhancedSliceConverter() {
  console.log('🔪✨ Testing Enhanced Slice-Based Format Converter\n');
  
  // Mock Discord message object for testing mentions
  const mockMessage = {
    mentions: {
      users: new Map([
        ['123456789', { globalName: 'JohnDoe', username: 'johndoe', displayName: 'John' }],
        ['987654321', { globalName: 'AliceSmith', username: 'alice', displayName: 'Alice' }]
      ]),
      roles: new Map([
        ['111111111', { name: 'Admin' }],
        ['222222222', { name: 'Moderator' }],
        ['333333333', { name: 'VIP' }]
      ]),
      channels: new Map([
        ['444444444', { name: 'general' }],
        ['555555555', { name: 'announcements' }]
      ])
    },
    guild: {
      channels: {
        cache: new Map([
          ['666666666', { name: 'private-chat' }]
        ])
      }
    }
  };
  
  // Test cases showcasing enhanced features
  const testCases = [
    {
      name: 'Discord mentions with real names',
      input: 'Hey <@123456789> and <@!987654321>, check <#444444444> for updates!',
      message: mockMessage
    },
    {
      name: 'Role mentions and formatting',
      input: '**Attention <@&111111111> and <@&222222222>!** New rules in <#555555555>',
      message: mockMessage
    },
    {
      name: 'Discord emojis with smart conversion',
      input: 'Great work! <:fire:123> <:heart:456> <:star:789> <:thumbsup:012> <:unknown_emoji:999>',
      message: mockMessage
    },
    {
      name: 'Complex mix: mentions + emojis + formatting',
      input: '**Welcome <@123456789>!** <:fire:123>\n\n### <:star:789> Server Rules:\n- Be nice <:heart:456>\n- Check <#444444444> daily\n- Contact <@&111111111> for help <:thumbsup:012>',
      message: mockMessage
    },
    {
      name: 'Animated emojis and edge cases',
      input: 'Party time! <a:party:123> <:dance:456> <:celebration:789> <:woohoo:000>',
      message: mockMessage
    },
    {
      name: 'Mixed formatting with unresolved mentions',
      input: '**Bold text** with <@999999999> and <@&888888888> and <#777777777> (unresolved)',
      message: mockMessage
    },
    {
      name: 'Your original examples enhanced',
      input: '- Removed `Rapidfire` <:warning:123>, feature will be moved to "Unsafe mode" later\n- Removed `Uid Changer` <:check:456>\n- Installed **overall security update** <:fire:789>. (СN / Europe / Asia builds)',
      message: mockMessage
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📝 Test Case: ${testCase.name}`);
    console.log(`${'='.repeat(70)}`);
    console.log(`📥 Input: "${testCase.input}"`);
    console.log(`${'-'.repeat(70)}`);
    
    try {
      // Method 1: Regular conversion (old way)
      console.log('⚙️  Method 1 - Regular Conversion:');
      const regularResult = FormatConverter.discordToTelegramMarkdownV2(testCase.input);
      console.log(`"${regularResult}"`);
      console.log();
      
      // Method 2: Basic slice-based conversion
      console.log('🔪 Method 2 - Basic Slice Conversion:');
      const sliceResult = await SliceFormatConverter.convertDiscordToTelegramMarkdownV2(testCase.input, testCase.message);
      console.log(`"${sliceResult}"`);
      console.log();
      
      // Method 3: Enhanced slice-based conversion (NEW)
      console.log('🔪✨ Method 3 - Enhanced Slice Conversion (with mentions/emojis):');
      const enhancedResult = await SliceFormatConverterEnhanced.convertDiscordToTelegramMarkdownV2(testCase.input, testCase.message);
      console.log(`"${enhancedResult}"`);
      console.log();
      
      // Show enhancement details
      console.log('🔍 Enhancement Details:');
      
      // Show mention resolution
      const mentionMap = SliceFormatConverterEnhanced.extractAndResolveMentions(testCase.input, testCase.message);
      if (mentionMap.users.size > 0 || mentionMap.roles.size > 0 || mentionMap.channels.size > 0) {
        console.log('  📧 Resolved Mentions:');
        mentionMap.users.forEach((name, mention) => {
          console.log(`    ${mention} -> ${name}`);
        });
        mentionMap.roles.forEach((name, mention) => {
          console.log(`    ${mention} -> ${name}`);
        });
        mentionMap.channels.forEach((name, mention) => {
          console.log(`    ${mention} -> ${name}`);
        });
      }
      
      // Show emoji conversions
      const emojiMatches = testCase.input.match(/<a?:(\w+):\d+>/g);
      if (emojiMatches) {
        console.log('  😀 Emoji Conversions:');
        emojiMatches.forEach(emoji => {
          const emojiName = emoji.match(/<a?:(\w+):\d+>/)[1];
          const converted = SliceFormatConverterEnhanced.convertDiscordEmojiToStandard(emojiName);
          console.log(`    ${emoji} -> ${converted || '[removed]'}`);
        });
      }
      
      // Show slice breakdown
      const slices = SliceFormatConverterEnhanced.parseTextIntoSlices(testCase.input);
      console.log('  🔪 Slice Breakdown:');
      slices.forEach((slice, index) => {
        console.log(`    Slice ${index + 1}: [${slice.type}] "${slice.content}"`);
      });
      
      // Compare results
      console.log('\n🔄 Comparison:');
      if (regularResult === enhancedResult) {
        console.log('✅ Regular and Enhanced results are identical');
      } else {
        console.log('❗ Results differ:');
        console.log(`   Regular:  "${regularResult}"`);
        console.log(`   Enhanced: "${enhancedResult}"`);
      }
      
      if (sliceResult === enhancedResult) {
        console.log('✅ Basic slice and Enhanced slice results are identical');
      } else {
        console.log('🆕 Enhanced slice provides improvements:');
        console.log(`   Basic:    "${sliceResult}"`);
        console.log(`   Enhanced: "${enhancedResult}"`);
      }
      
    } catch (error) {
      console.error(`❌ Error in test case "${testCase.name}":`, error.message);
    }
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('🏁 Enhanced Testing Complete!');
  console.log(`${'='.repeat(70)}`);
  console.log('\n📊 Summary of Enhancement Features:');
  console.log('🔪✨ Enhanced Slice-Based Converter provides:');
  console.log('   • Smart Discord mention resolution (users, roles, channels)');
  console.log('   • Intelligent Discord emoji → standard emoji conversion');
  console.log('   • 200+ emoji mappings with partial matching');
  console.log('   • 1:1 slice precision for formatting elements');
  console.log('   • Fallback handling for unresolved mentions/emojis');
  console.log('   • Separate implementation - doesn\'t touch AI/old methods');
}

// Configuration demo
function showEnhancedConfigurationOptions() {
  console.log('\n⚙️  Enhanced Configuration Options in config/env.js:');
  console.log('');
  console.log('// Choose your formatting approach (NEW PRIORITY ORDER):');
  console.log('useEnhancedSliceConverter: true,  // Method 4: Enhanced slice with mentions/emojis (NEW!)');
  console.log('useSliceFormatConverter: true,    // Method 3: Basic slice-based conversion');
  console.log('useAIFormatConverter: false,      // Method 2: AI-powered conversion');
  console.log('// Method 1: Regular conversion (always available as fallback)');
  console.log('');
  console.log('// NEW Priority order: Enhanced Slice > Slice > AI > Regular');
  console.log('// - Enhanced slice handles mentions and emojis intelligently');
  console.log('// - Falls back gracefully through each method if errors occur');
  console.log('// - Each method is completely independent and safe');
}

// Run the tests
if (require.main === module) {
  testEnhancedSliceConverter().then(() => {
    showEnhancedConfigurationOptions();
  }).catch(console.error);
}

module.exports = { testEnhancedSliceConverter };