function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderDashboardPage(auth, webAdminConfig) {
  const tag = escapeHtml(auth.user.global_name || auth.user.username || auth.user.id);
  const debugEnabled = Boolean(webAdminConfig && webAdminConfig.debug);
  const debugNavButton = debugEnabled
    ? '<button id="tab-btn-debug" data-tab="debug" role="tab" aria-selected="false" aria-controls="tab-debug" tabindex="-1">Debug</button>'
    : '';
  const debugTabSection = debugEnabled
    ? `
    <!-- Debug Tab -->
    <section id="tab-debug" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-debug" aria-hidden="true">
      <div class="card">
        <div class="header-bar">
          <h2>Database Diagnostics</h2>
          <button id="debug-refresh" class="button secondary sm" type="button">Refresh</button>
        </div>
        <p class="muted-text">Read-only curated diagnostics. Raw SQL input is intentionally not exposed.</p>
        <div id="debug-db-summary" class="stat-grid">
          <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Loading</div></div>
        </div>
      </div>

      <div class="card">
        <div class="header-bar">
          <h2>Message Drilldown</h2>
          <div class="row">
            <input id="debug-message-id" class="input" type="text" placeholder="Discord message ID">
            <button id="debug-message-search" class="button secondary sm" type="button">Search</button>
          </div>
        </div>
        <p class="muted-text">Search by original or forwarded message ID. Includes edit-handler success subset.</p>
        <p id="debug-message-meta" class="muted-text">Enter a message ID and click Search.</p>

        <h3>All Matches</h3>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Status</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="debug-message-all-body">
              <tr><td colspan="7" class="muted-text">Enter a message ID and click Search.</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Edit Handler Matches (Original + Success)</h3>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Status</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="debug-message-edit-body">
              <tr><td colspan="7" class="muted-text">Enter a message ID and click Search.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Message Log Status Counts</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody id="debug-log-status-body">
              <tr><td colspan="2" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Telegram Discovery Sources</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>discoveredVia</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody id="debug-discovered-via-body">
              <tr><td colspan="2" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Recent Bot Setting Updates</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody id="debug-settings-body">
              <tr><td colspan="2" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Recent Message Logs</h2>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Status</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
              </tr>
            </thead>
            <tbody id="debug-recent-logs-body">
              <tr><td colspan="6" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Recent Failed Logs</h2>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Config</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="debug-failed-logs-body">
              <tr><td colspan="4" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>`
    : '';
  const debugScriptTag = debugEnabled
    ? '\n  <script src="/admin/static/debug.js"></script>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ProForwarder Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="/admin/static/styles.css">
</head>
<body>
  <main class="layout">
    <section class="card">
      <div class="header-bar">
        <h1>ProForwarder Admin</h1>
        <div class="row">
          <span class="badge" data-user-tag>${tag}</span>
          <a class="button secondary sm" href="/admin/logout">Logout</a>
        </div>
      </div>
      <p id="status-message" class="muted-text" role="status" aria-live="polite">Ready.</p>
    </section>

    <nav class="tab-nav" role="tablist" aria-label="Admin Sections">
      <button id="tab-btn-dashboard" data-tab="dashboard" class="active" role="tab" aria-selected="true" aria-controls="tab-dashboard" tabindex="0">Dashboard</button>
      <button id="tab-btn-configs" data-tab="configs" role="tab" aria-selected="false" aria-controls="tab-configs" tabindex="-1">Configs</button>
      <button id="tab-btn-autopublish" data-tab="autopublish" role="tab" aria-selected="false" aria-controls="tab-autopublish" tabindex="-1">Auto Publish</button>
      <button id="tab-btn-guilds" data-tab="guilds" role="tab" aria-selected="false" aria-controls="tab-guilds" tabindex="-1">Guilds</button>
      <button id="tab-btn-logs" data-tab="logs" role="tab" aria-selected="false" aria-controls="tab-logs" tabindex="-1">Logs</button>
      <button id="tab-btn-settings" data-tab="settings" role="tab" aria-selected="false" aria-controls="tab-settings" tabindex="-1">Settings</button>
      ${debugNavButton}
    </nav>

    <!-- Dashboard Tab -->
    <section id="tab-dashboard" class="tab-panel active" role="tabpanel" aria-labelledby="tab-btn-dashboard" aria-hidden="false">
      <div class="card">
        <h2>Bot Status</h2>
        <div id="dashboard-stats" class="stat-grid">
          <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Status</div></div>
        </div>
      </div>
      <div class="card">
        <div class="header-bar">
          <h2>Reader Diagnostics</h2>
          <button id="reader-diagnostics-refresh" class="button secondary sm" type="button">Refresh</button>
        </div>
        <div id="reader-diagnostics-panel" class="reader-diagnostics">
          <p class="muted-text">Loading reader diagnostics...</p>
        </div>
      </div>
    </section>

    <!-- Configs Tab -->
    <section id="tab-configs" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-configs" aria-hidden="true">
      <div class="card">
        <h2>Guild</h2>
        <select id="guild-select" class="input">
          <option value="">Loading guilds...</option>
        </select>
      </div>

      <div class="card">
        <h2>Forward Configurations</h2>
        <div class="table-wrapper">
          <table class="configs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Source</th>
                <th>Target</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="configs-body">
              <tr><td colspan="6" class="muted-text">Select a guild first.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Forward Builder</h2>
        <div class="forward-builder">
          <div class="forward-subtabs" role="tablist" aria-label="Forward Type">
            <button id="forward-tab-discord" class="forward-subtab-btn active" data-forward-tab="discord" role="tab" aria-selected="true" aria-controls="forward-panel-discord" tabindex="0">Discord</button>
            <button id="forward-tab-telegram" class="forward-subtab-btn" data-forward-tab="telegram" role="tab" aria-selected="false" aria-controls="forward-panel-telegram" tabindex="-1">Telegram</button>
          </div>

          <section id="forward-panel-discord" class="forward-panel active" data-forward-panel="discord" role="tabpanel" aria-labelledby="forward-tab-discord" aria-hidden="false">
            <h3>Create Discord Forward</h3>
            <form id="create-discord-form" class="form-grid config-builder-form">
              <div class="config-builder-grid">
                <fieldset class="config-box">
                  <legend>Source</legend>
                  <label>Source Bot
                    <select id="discord-source-bot" class="input">
                      <option value="main">Main Bot</option>
                    </select>
                  </label>
                  <label>Source Server
                    <input id="discord-source-server-search" class="input select-search" placeholder="Search source servers">
                    <select id="discord-source-server" class="input" required>
                      <option value="">Loading source servers...</option>
                    </select>
                  </label>
                  <label>Source Channel
                    <input id="discord-source-channel-search" class="input select-search" placeholder="Search source channels">
                    <select id="discord-source-channel" class="input" required>
                      <option value="">Select source server first</option>
                    </select>
                  </label>
                </fieldset>
                <fieldset class="config-box">
                  <legend>Target</legend>
                  <label>Target Server (Main Bot)
                    <input id="discord-target-server-search" class="input select-search" placeholder="Search target servers">
                    <select id="discord-target-server" class="input" required>
                      <option value="">Loading target servers...</option>
                    </select>
                  </label>
                  <label>Target Channel (Main Bot)
                    <input id="discord-target-channel-search" class="input select-search" placeholder="Search target channels">
                    <select id="discord-target-channel" class="input" required>
                      <option value="">Select target server first</option>
                    </select>
                  </label>
                </fieldset>
              </div>
              <label>Name (optional)<input id="discord-name" class="input"></label>
              <button type="submit" class="button">Create Discord Forward</button>
            </form>
          </section>

          <section id="forward-panel-telegram" class="forward-panel" data-forward-panel="telegram" role="tabpanel" aria-labelledby="forward-tab-telegram" aria-hidden="true">
            <h3>Create Telegram Forward</h3>
            <form id="create-telegram-form" class="form-grid config-builder-form">
              <div class="config-builder-grid">
                <fieldset class="config-box">
                  <legend>Source</legend>
                  <label>Source Bot
                    <select id="telegram-source-bot" class="input">
                      <option value="main">Main Bot</option>
                    </select>
                  </label>
                  <label>Source Server
                    <input id="telegram-source-server-search" class="input select-search" placeholder="Search source servers">
                    <select id="telegram-source-server" class="input" required>
                      <option value="">Loading source servers...</option>
                    </select>
                  </label>
                  <label>Source Channel
                    <input id="telegram-source-channel-search" class="input select-search" placeholder="Search source channels">
                    <select id="telegram-source-channel" class="input" required>
                      <option value="">Select source server first</option>
                    </select>
                  </label>
                </fieldset>
                <fieldset class="config-box">
                  <legend>Target</legend>
                  <label>Target Chat<input id="telegram-chat-id" class="input" required placeholder="Select above or enter Chat ID, @username, or t.me link"></label>
                  <p id="telegram-chat-hint" class="muted-text">Enter Chat ID, @username, or t.me link. Bot access is verified automatically when creating the forward.</p>
                  <label>Tracked Telegram Chats
                    <input id="telegram-chat-search" class="input select-search" placeholder="Search tracked chats">
                    <select id="telegram-chat-select" class="input">
                      <option value="">Select a tracked chat (optional)</option>
                    </select>
                  </label>
                  <div class="row telegram-tracked-actions">
                    <button type="button" id="telegram-chat-remove-btn" class="button secondary sm danger">Remove Selected Tracked Chat</button>
                  </div>
                  <p class="muted-text">Removing a tracked chat only removes it from this list. It does not remove the bot from Telegram.</p>
                </fieldset>
              </div>
              <label>Name (optional)<input id="telegram-name" class="input"></label>
              <button type="submit" class="button">Create Telegram Forward</button>
            </form>
          </section>
        </div>
      </div>
    </section>

    <!-- Auto Publish Tab -->
    <section id="tab-autopublish" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-autopublish" aria-hidden="true">
      <div class="card">
        <h2>Auto Publish</h2>
        <p class="muted-text">Manage announcement channels where the bot auto-publishes posts after 1 minute.</p>
        <div class="form-grid">
          <label>Server
            <input id="autopublish-guild-search" class="input select-search" placeholder="Search servers">
            <select id="autopublish-guild-select" class="input">
              <option value="">Loading servers...</option>
            </select>
          </label>
          <label>Announcement Channel
            <input id="autopublish-channel-search" class="input select-search" placeholder="Search announcement channels">
            <select id="autopublish-channel-select" class="input">
              <option value="">Select a server first</option>
            </select>
          </label>
        </div>
        <div class="row autopublish-actions">
          <span id="autopublish-selected-state" class="status-badge retry">Select a channel</span>
          <button id="autopublish-toggle-btn" class="button secondary sm" type="button" disabled>Enable</button>
          <button id="autopublish-refresh-btn" class="button secondary sm" type="button">Refresh</button>
        </div>
      </div>

      <div class="card">
        <h2>Enabled Announcement Channels</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Channel</th>
                <th>ID</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="autopublish-enabled-body">
              <tr><td colspan="4" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Guilds Tab -->
    <section id="tab-guilds" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-guilds" aria-hidden="true">
      <div class="card">
        <h2>Invite Bots</h2>
        <p class="muted-text">Add the bots to a new server using the invite links below.</p>
        <div id="invite-cards" class="stat-grid"></div>
      </div>

      <div class="card">
        <h2>Main Bot Guilds</h2>
        <p class="muted-text">Servers the main bot is currently in.</p>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th class="icon-col"></th>
                <th>Name</th>
                <th>ID</th>
                <th>Members</th>
                <th>Owner</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="main-guilds-body">
              <tr><td colspan="7" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Reader Bot Guilds</h2>
        <p class="muted-text" id="reader-guilds-status">Servers the reader bot is currently in.</p>
        <div class="table-wrapper" id="reader-guilds-wrapper">
          <table>
            <thead>
              <tr>
                <th class="icon-col"></th>
                <th>Name</th>
                <th>ID</th>
                <th>Members</th>
                <th>Owner</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="reader-guilds-body">
              <tr><td colspan="7" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="header-bar">
          <h2>Reader Bot Debug</h2>
          <button id="reader-debug-refresh" class="button secondary sm" type="button">Refresh Debug</button>
        </div>
        <p class="muted-text">Shows the live OAuth, main bot, and reader bot guild state for the currently selected guild.</p>
        <pre id="reader-debug-output" class="debug-panel-output mono">Loading debug data...</pre>
      </div>
    </section>

    <!-- Logs Tab -->
    <section id="tab-logs" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-logs" aria-hidden="true">
      <div class="card">
        <h2>Message Logs</h2>
        <div class="filter-bar">
          <select id="logs-config-filter" class="input">
            <option value="">All Configs</option>
          </select>
          <select id="logs-status-filter" class="input">
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="retry">Retry</option>
          </select>
          <input id="logs-message-search" class="input filter-wide-input" placeholder="Search message ID (source or forwarded)">
          <button id="logs-search" class="button secondary sm">Search</button>
          <button id="logs-clear-search" class="button secondary sm">Clear</button>
          <button id="logs-refresh" class="button secondary sm">Refresh</button>
          <button id="logs-delete-failed" class="button secondary sm danger">Delete Failed Logs</button>
        </div>
        <div class="filter-bar">
          <input id="logs-retry-source-id" class="input filter-wide-input" placeholder="Source message ID to retry">
          <button id="logs-retry-source" class="button secondary sm">Retry Source Message</button>
        </div>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
                <th>Target</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="logs-body">
              <tr><td colspan="7" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <button id="logs-load-more" class="button secondary sm is-hidden">Load More</button>
        </div>
      </div>
    </section>

    <!-- Settings Tab -->
    <section id="tab-settings" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-settings" aria-hidden="true">
      <div class="card">
        <h2>Runtime Configuration</h2>
        <p class="muted-text">Read-only values from config.js. Edit the config file to change these.</p>
        <div id="runtime-config" class="runtime-grid"></div>
      </div>
      <div class="card">
        <h2>Bot Settings</h2>
        <p class="muted-text">Manage existing settings stored in SQLite. New setting creation is disabled in web admin.</p>
        <div class="settings-help">
          <div class="settings-help-item">
            <strong>Existing keys only</strong>
            <p class="muted-text">This page edits existing settings only. New keys are not created from web admin.</p>
          </div>
          <div class="settings-help-item">
            <strong>Emoji behavior</strong>
            <p class="muted-text"><code>uploaded_emoji_names</code> is managed automatically. Add/edit is disabled; remove entries individually.</p>
          </div>
        </div>
        <div id="bot-settings" class="settings-section"></div>
      </div>
    </section>
    ${debugTabSection}

    <div id="confirm-modal" class="modal-overlay" aria-hidden="true">
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-body">
        <div id="confirm-modal-title" class="modal-title">Please Confirm</div>
        <div id="confirm-modal-body" class="modal-body"></div>
        <div class="modal-actions">
          <button id="confirm-modal-cancel" class="button secondary" type="button">Cancel</button>
          <button id="confirm-modal-ok" class="button danger" type="button">Confirm</button>
        </div>
      </div>
    </div>
  </main>

  <script src="/admin/static/app.js"></script>
  <script src="/admin/static/dashboard.js"></script>
  <script src="/admin/static/configs.js"></script>
  <script src="/admin/static/autopublish.js"></script>
  <script src="/admin/static/guilds.js"></script>
  <script src="/admin/static/logs.js"></script>
  <script src="/admin/static/settings.js"></script>${debugScriptTag}
</body>
</html>`;
}

module.exports = { renderDashboardPage };
