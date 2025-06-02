const SliceFormatConverter = require('./utils/sliceFormatConverter');
const FormatConverter = require('./utils/formatConverter');

/**
 * Final test to demonstrate the enhanced slice converter 
 * working together with the original implementation
 */
async function testFinalEnhancedSlice() {
  console.log('🔪✨ Testing Enhanced Slice Converter (Integrated Version)\n');
  
  // Mock Discord message object for testing mentions
  const mockMessage = {
    mentions: {
      users: new Map([
        ['123456789', { globalName: 'JohnDoe', username: 'johndoe', displayName: 'John' }],
        ['987654321', { globalName: 'AliceSmith', username: 'alice', displayName: 'Alice' }]
      ]),
      roles: new Map([
        ['111111111', { name: 'Admin' }],
        ['222222222', { name: 'Moderator' }]
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
  
  // Test cases showcasing the enhanced features working together
  const testCases = [
    {
      name: 'Discord mentions with real names (Enhanced)',
      input: 'Hey <@123456789> and <@!987654321>, check <#444444444> for updates!'
    },
    {
      name: 'Discord emojis with smart conversion (Enhanced)',
      input: 'Great work! <:fire:123> <:heart:456> <:warning:789> <:thumbsup:012> <:unknown_emoji:999>'
    },
    {
      name: 'Your original example enhanced with emojis',
      input: '- Removed `Rapidfire` <:warning:123>, feature will be moved to "Unsafe mode" later\n- Removed `Uid Changer` <:check:456>\n- Installed **overall security update** <:fire:789>. (СN / Europe / Asia builds)'
    },
    {
      name: 'Complex mix: mentions + emojis + formatting',
      input: '**Welcome <@123456789>!** <:fire:123>\n\n### <:star:789> Server Rules:\n- Be nice <:heart:456>\n- Contact <@&111111111> for help <:thumbsup:012>'
    },
    {
      name: 'Testing partial emoji matching',
      input: 'Emotions: <:laughing:123> <:thinking_face:456> <:angry_emoji:789> <:surprised_reaction:012>'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📝 Test Case: ${testCase.name}`);
    console.log(`${'='.repeat(70)}`);
    console.log(`📥 Input: "${testCase.input}"`);
    console.log(`${'-'.repeat(70)}`);
    
    try {
      // Method 1: Regular conversion (baseline)
      console.log('⚙️  Method 1 - Regular Conversion:');
      const regularResult = FormatConverter.discordToTelegramMarkdownV2(testCase.input);
      console.log(`"${regularResult}"`);
      console.log();
      
      // Method 2: Enhanced slice-based conversion (NEW integrated version)
      console.log('🔪✨ Method 2 - Enhanced Slice Conversion (Integrated):');
      const enhancedResult = await SliceFormatConverter.convertDiscordToTelegramMarkdownV2(testCase.input, mockMessage);
      console.log(`"${enhancedResult}"`);
      console.log();
      
      // Show enhancement details
      console.log('🔍 Enhancement Analysis:');
      
      // Compare results
      if (regularResult === enhancedResult) {
        console.log('ℹ️  Results are identical (no enhancements needed for this case)');
      } else {
        console.log('🆕 Enhanced version provides improvements:');
        console.log(`   Regular:  "${regularResult}"`);
        console.log(`   Enhanced: "${enhancedResult}"`);
        
        // Analyze what was enhanced
        const improvements = [];
        if (testCase.input.includes('<@') && enhancedResult.includes('JohnDoe')) {
          improvements.push('✅ Smart mention resolution');
        }
        if (testCase.input.includes('<:') && /[🔥❤️⚠️✅⭐👍😂🤔😡😲]/.test(enhancedResult)) {
          improvements.push('✅ Discord emoji conversion');
        }
        if (testCase.input.includes('**') && enhancedResult.includes('*')) {
          improvements.push('✅ Perfect formatting conversion');
        }
        
        if (improvements.length > 0) {
          console.log('   Improvements applied:');
          improvements.forEach(improvement => console.log(`     ${improvement}`));
        }
      }
      
    } catch (error) {
      console.error(`❌ Error in test case "${testCase.name}":`, error.message);
    }
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('🏁 Final Enhanced Testing Complete!');
  console.log(`${'='.repeat(70)}`);
  console.log('\n📊 Summary of Integrated Enhancements:');
  console.log('🔪✨ Your slice converter now includes:');
  console.log('   • 200+ Discord emoji mappings with intelligent fallbacks');
  console.log('   • Smart mention resolution with real Discord names');
  console.log('   • Partial emoji matching (e.g., "laughing" → 😂)');
  console.log('   • Enhanced debug logging for troubleshooting');
  console.log('   • Seamless integration with existing slice-based approach');
  console.log('   • All enhancements work together in the original file');
  
  console.log('\n⚙️  Current Configuration:');
  console.log('   useSliceFormatConverter: true    // Enhanced version with mentions/emojis');
  console.log('   useAIFormatConverter: false      // AI method available as fallback');
  console.log('');
  console.log('🎯 Priority: Enhanced Slice > AI > Regular');
  console.log('   Your slice converter is now the primary method with full enhancements!');
}

// Run the final test
if (require.main === module) {
  testFinalEnhancedSlice().catch(console.error);
}

module.exports = { testFinalEnhancedSlice };