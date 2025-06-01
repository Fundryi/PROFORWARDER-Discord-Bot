const FormatConverter = require('./utils/formatConverter');
const TelegramHandler = require('./handlers/telegramHandler');

async function testLiveTelegram() {
  console.log('=== Live Telegram MarkdownV2 Test ===\n');
  
  // Initialize Telegram handler
  const telegramHandler = new TelegramHandler();
  const initialized = await telegramHandler.initialize();
  
  if (!initialized) {
    console.error('❌ Failed to initialize Telegram handler');
    return;
  }
  
  console.log('✅ Telegram handler initialized successfully\n');
  
  // Test cases - start with simple ones and work up to complex
  const testCases = [
    {
      name: 'Simple text',
      input: 'Hello world'
    },
    {
      name: 'Bold only',
      input: 'This is **bold** text'
    },
    {
      name: 'Italic only', 
      input: 'This is *italic* text'
    },
    {
      name: 'Underline only',
      input: 'This is __underlined__ text'
    },
    {
      name: 'Bold and italic',
      input: 'This is **bold** and *italic* text'
    },
    {
      name: 'All formatting',
      input: 'This is **bold** and *italic* and __underlined__ text'
    },
    {
      name: 'Text with underscores',
      input: 'This has under_scores in_text'
    },
    {
      name: 'Complex real example',
      input: 'Check out this **awesome** *feature* with __underlined__ text and some_variable_names here!'
    }
  ];
  
  // Get chat ID from config
  let chatId;
  try {
    const config = require('./config/env');
    // Use the chat ID from the Telegram forward config
    const telegramForward = config.forwardConfigs.find(c => c.targetType === 'telegram');
    chatId = telegramForward?.targetChatId;
    
    if (!chatId) {
      console.error('❌ No Telegram chat ID found in forwardConfigs');
      return;
    }
    console.log(`📱 Using chat ID: ${chatId}\n`);
  } catch (error) {
    console.error('❌ Failed to load config:', error.message);
    return;
  }
  
  // Test each case
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n--- Test ${i + 1}: ${testCase.name} ---`);
    console.log(`📝 Input: "${testCase.input}"`);
    
    try {
      // Convert to MarkdownV2
      const converted = FormatConverter.discordToTelegramMarkdownV2(testCase.input);
      console.log(`🔄 Converted: "${converted}"`);
      
      // Check entity counts
      const unescapedCounts = {
        '*': (converted.match(/(?<!\\)\*/g) || []).length,
        '_': (converted.match(/(?<!\\)_/g) || []).length,
        '~': (converted.match(/(?<!\\)~/g) || []).length,
        '|': (converted.match(/(?<!\\)\|/g) || []).length
      };
      
      console.log('📊 Unescaped entity counts:', unescapedCounts);
      
      // Check if entities are paired
      const isPaired = Object.entries(unescapedCounts).every(([char, count]) => count % 2 === 0);
      console.log(`🔗 Entities paired: ${isPaired ? '✅' : '❌'}`);
      
      if (!isPaired) {
        console.log('⚠️  WARNING: Unmatched entities detected - this will likely fail');
      }
      
      // Try to send to Telegram
      console.log('📤 Sending to Telegram...');
      
      const mockMessage = {
        content: testCase.input,
        embeds: [],
        attachments: new Map(),
        stickers: new Map()
      };
      
      const result = await telegramHandler.sendMessage(chatId, mockMessage);
      
      if (result) {
        console.log(`✅ SUCCESS: Message sent! Message ID: ${result.message_id}`);
      } else {
        console.log('❌ FAILED: No result returned');
      }
      
    } catch (error) {
      console.log(`❌ FAILED: ${error.message}`);
      
      // If it's a parsing error, show the byte offset
      if (error.message.includes('byte offset')) {
        const match = error.message.match(/byte offset (\d+)/);
        if (match) {
          const offset = parseInt(match[1]);
          const converted = FormatConverter.discordToTelegramMarkdownV2(testCase.input);
          console.log(`🔍 Character at byte ${offset}: "${converted[offset] || 'END'}" (${converted.charCodeAt(offset) || 'N/A'})`);
          console.log(`🔍 Context: "...${converted.substring(Math.max(0, offset-10), offset+10)}..."`);
        }
      }
    }
    
    // Wait a bit between requests to avoid rate limiting
    if (i < testCases.length - 1) {
      console.log('⏳ Waiting 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n=== Test Complete ===');
}

// Run the test
testLiveTelegram().catch(error => {
  console.error('💥 Test failed:', error);
});