# Debug Test Files

This folder contains test files used during the development and debugging of the MarkdownV2 conversion feature.

## Files:

- **`test_telegram_live.js`** - Live Telegram API testing with various message formats
- **`test_real_discord.js`** - Tests the actual Discord message format provided by the user
- **`final_verification_test.js`** - Comprehensive verification of all MarkdownV2 conversions
- **`debug_env.js`** - Environment variable debugging and configuration testing

## Usage:

These files can be used to test and debug the MarkdownV2 conversion functionality:

```bash
# Test with live Telegram API
node debug/test_telegram_live.js

# Test with real Discord format
node debug/test_real_discord.js

# Run comprehensive verification
node debug/final_verification_test.js

# Debug environment configuration
node debug/debug_env.js
```

## Notes:

- Make sure Telegram is enabled in config (`TELEGRAM_ENABLED=true`)
- Requires valid Telegram bot token in `.env`
- Uses the chat ID from `forwardConfigs` in `config/env.js`