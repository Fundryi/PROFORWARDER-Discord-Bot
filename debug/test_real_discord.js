const FormatConverter = require('./utils/formatConverter');
const TelegramHandler = require('./handlers/telegramHandler');

async function testRealDiscordText() {
  console.log('=== Testing Real Discord Source Text ===\n');
  
  // The actual Discord text you provided
  const realDiscordText = `This is a cool test. 
**Bold** 
*Itally * 
\`Code\` 
~~Strike ~~ 
\`QUOTE\` 
||SPOILER|| 

\`\`\`
CODE IN HERE
\`\`\``;

  console.log('📝 Real Discord Input:');
  console.log(realDiscordText);
  console.log('\n' + '='.repeat(50) + '\n');

  // Initialize Telegram handler
  const telegramHandler = new TelegramHandler();
  const initialized = await telegramHandler.initialize();
  
  if (!initialized) {
    console.error('❌ Failed to initialize Telegram handler');
    return;
  }
  
  console.log('✅ Telegram handler initialized successfully\n');
  
  // Get chat ID
  const config = require('./config/env');
  const telegramForward = config.forwardConfigs.find(c => c.targetType === 'telegram');
  const chatId = telegramForward?.targetChatId;
  
  if (!chatId) {
    console.error('❌ No Telegram chat ID found');
    return;
  }
  
  console.log(`📱 Using chat ID: ${chatId}\n`);

  try {
    // Convert to MarkdownV2
    console.log('🔄 Converting to MarkdownV2...');
    const converted = FormatConverter.discordToTelegramMarkdownV2(realDiscordText);
    console.log('📤 Converted Result:');
    console.log(`"${converted}"`);
    console.log('\n');
    
    // Analyze the conversion
    const unescapedCounts = {
      '*': (converted.match(/(?<!\\)\*/g) || []).length,
      '_': (converted.match(/(?<!\\)_/g) || []).length,
      '~': (converted.match(/(?<!\\)~/g) || []).length,
      '|': (converted.match(/(?<!\\)\|/g) || []).length,
      '`': (converted.match(/(?<!\\)`/g) || []).length
    };
    
    console.log('📊 Unescaped entity counts:', unescapedCounts);
    
    // Check if entities are paired
    const pairedCheck = {
      '*': unescapedCounts['*'] % 2 === 0,
      '_': unescapedCounts['_'] % 2 === 0,
      '~': unescapedCounts['~'] % 2 === 0,
      '|': unescapedCounts['|'] % 2 === 0,
      '`': unescapedCounts['`'] % 2 === 0
    };
    
    console.log('🔗 Entity pairing check:', pairedCheck);
    
    const allPaired = Object.values(pairedCheck).every(p => p);
    console.log(`✅ All entities paired: ${allPaired ? 'YES' : 'NO'}`);
    
    if (!allPaired) {
      console.log('⚠️  WARNING: Unmatched entities detected - this will likely fail on Telegram!');
      
      // Show which entities are problematic
      Object.entries(pairedCheck).forEach(([char, paired]) => {
        if (!paired) {
          console.log(`❌ Unmatched ${char}: count = ${unescapedCounts[char]}`);
        }
      });
    }
    
    console.log('\n📤 Sending to Telegram...');
    
    const mockMessage = {
      content: realDiscordText,
      embeds: [],
      attachments: new Map(),
      stickers: new Map()
    };
    
    const result = await telegramHandler.sendMessage(chatId, mockMessage);
    
    if (result) {
      console.log(`✅ SUCCESS: Message sent to Telegram! Message ID: ${result.message_id}`);
      console.log('🎉 MarkdownV2 conversion is working correctly!');
    } else {
      console.log('❌ FAILED: No result returned');
    }
    
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    
    // If it's a parsing error, show detailed analysis
    if (error.message.includes('byte offset')) {
      const match = error.message.match(/byte offset (\d+)/);
      if (match) {
        const offset = parseInt(match[1]);
        const converted = FormatConverter.discordToTelegramMarkdownV2(realDiscordText);
        console.log(`\n🔍 DETAILED ERROR ANALYSIS:`);
        console.log(`Character at byte ${offset}: "${converted[offset] || 'END'}" (ASCII: ${converted.charCodeAt(offset) || 'N/A'})`);
        console.log(`Context around error: "...${converted.substring(Math.max(0, offset-15), offset+15)}..."`);
        console.log(`\nFull converted text for analysis:`);
        console.log(`"${converted}"`);
      }
    }
  }
  
  console.log('\n=== Real Discord Test Complete ===');
}

// Run the test
testRealDiscordText().catch(error => {
  console.error('💥 Test failed:', error);
});