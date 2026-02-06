/* configs.js -- Forward configuration management tab */
(function () {
  'use strict';

  var configsBody = document.getElementById('configs-body');
  var createDiscordForm = document.getElementById('create-discord-form');
  var createTelegramForm = document.getElementById('create-telegram-form');

  var discordSourceServerSearch = document.getElementById('discord-source-server-search');
  var discordSourceServerSelect = document.getElementById('discord-source-server');
  var discordSourceChannelSearch = document.getElementById('discord-source-channel-search');
  var discordSourceChannelSelect = document.getElementById('discord-source-channel');
  var discordTargetServerSearch = document.getElementById('discord-target-server-search');
  var discordTargetServerSelect = document.getElementById('discord-target-server');
  var discordTargetChannelSearch = document.getElementById('discord-target-channel-search');
  var discordTargetChannelSelect = document.getElementById('discord-target-channel');

  var telegramSourceServerSearch = document.getElementById('telegram-source-server-search');
  var telegramSourceServerSelect = document.getElementById('telegram-source-server');
  var telegramSourceChannelSearch = document.getElementById('telegram-source-channel-search');
  var telegramSourceChannelSelect = document.getElementById('telegram-source-channel');
  var telegramChatSearch = document.getElementById('telegram-chat-search');
  var telegramChatSelect = document.getElementById('telegram-chat-select');
  var telegramChatIdInput = document.getElementById('telegram-chat-id');
  var telegramChatHint = document.getElementById('telegram-chat-hint');

  var setupState = {
    loaded: false,
    loading: false,
    guilds: [],
    telegram: {
      enabled: false,
      chats: [],
      warnings: []
    },
    discordSourceGuildId: '',
    discordTargetGuildId: '',
    telegramSourceGuildId: ''
  };

  function setConfigsMessage(message) {
    configsBody.innerHTML = '';
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'muted-text';
    cell.textContent = message;
    row.appendChild(cell);
    configsBody.appendChild(row);
  }

  function targetText(config) {
    if (config.targetType === 'telegram') {
      return 'Telegram ' + config.targetChatId;
    }
    if (config.targetServerId && config.targetChannelId) {
      return 'Discord ' + config.targetServerId + ':' + config.targetChannelId;
    }
    if (config.targetChannelId) {
      return 'Discord ' + config.targetChannelId;
    }
    return '-';
  }

  function createCell(text) {
    var cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }

  function renderConfigs(configs) {
    configsBody.innerHTML = '';
    if (!configs.length) {
      setConfigsMessage('No configurations found for this guild.');
      return;
    }

    for (var i = 0; i < configs.length; i++) {
      var config = configs[i];
      var row = document.createElement('tr');
      row.appendChild(createCell(String(config.id)));
      row.appendChild(createCell(config.name || 'Unnamed'));
      row.appendChild(createCell(config.sourceChannelId || '-'));
      row.appendChild(createCell(targetText(config)));
      row.appendChild(createCell(config.enabled !== false ? 'Enabled' : 'Disabled'));

      var actionsCell = document.createElement('td');

      (function (cfg) {
        var toggleButton = document.createElement('button');
        toggleButton.className = 'button secondary sm';
        toggleButton.textContent = cfg.enabled !== false ? 'Disable' : 'Enable';
        toggleButton.addEventListener('click', async function () {
          try {
            AdminApp.setStatus('Updating config ' + cfg.id + '...');
            await AdminApp.fetchJson('/api/configs/' + cfg.id, {
              method: 'PATCH',
              body: JSON.stringify({ enabled: !(cfg.enabled !== false) })
            });
            AdminApp.setStatus('Config ' + cfg.id + ' updated.');
            await loadConfigs(AdminApp.state.currentGuildId);
          } catch (error) {
            AdminApp.setStatus('Update failed: ' + error.message, true);
          }
        });
        actionsCell.appendChild(toggleButton);

        var removeButton = document.createElement('button');
        removeButton.className = 'button secondary sm danger';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', async function () {
          if (!confirm('Remove config ' + cfg.id + '?')) return;
          try {
            AdminApp.setStatus('Removing config ' + cfg.id + '...');
            await AdminApp.fetchJson('/api/configs/' + cfg.id, { method: 'DELETE' });
            AdminApp.setStatus('Config ' + cfg.id + ' removed.');
            await loadConfigs(AdminApp.state.currentGuildId);
          } catch (error) {
            AdminApp.setStatus('Remove failed: ' + error.message, true);
          }
        });
        actionsCell.appendChild(removeButton);

        if (cfg.targetType === 'telegram') {
          var testButton = document.createElement('button');
          testButton.className = 'button secondary sm';
          testButton.textContent = 'Test TG';
          testButton.addEventListener('click', async function () {
            try {
              AdminApp.setStatus('Testing Telegram for config ' + cfg.id + '...');
              var result = await AdminApp.fetchJson('/api/configs/' + cfg.id + '/test-telegram', { method: 'POST' });
              AdminApp.setStatus('Telegram test success. Message ID: ' + (result.messageId || '-'));
            } catch (error) {
              AdminApp.setStatus('Telegram test failed: ' + error.message, true);
            }
          });
          actionsCell.appendChild(testButton);
        }
      })(config);

      row.appendChild(actionsCell);
      configsBody.appendChild(row);
    }
  }

  async function loadConfigs(guildId) {
    if (!guildId) {
      setConfigsMessage('Select a guild to view configurations.');
      return;
    }

    setConfigsMessage('Loading...');
    try {
      var payload = await AdminApp.fetchJson('/api/configs?guildId=' + encodeURIComponent(guildId));
      renderConfigs(payload.configs || []);
    } catch (_error) {
      setConfigsMessage('Failed to load configurations.');
    }
  }

  function getGuildById(guildId) {
    for (var i = 0; i < setupState.guilds.length; i++) {
      if (setupState.guilds[i].id === guildId) return setupState.guilds[i];
    }
    return null;
  }

  function filterOptions(options, query, getLabel) {
    var trimmed = String(query || '').trim().toLowerCase();
    if (!trimmed) return options.slice();

    return options.filter(function (item) {
      var label = getLabel(item).toLowerCase();
      return label.indexOf(trimmed) >= 0 || String(item.id || '').toLowerCase().indexOf(trimmed) >= 0;
    });
  }

  function setSelectOptions(select, options, getLabel, emptyText, selectedId) {
    if (!select) return '';
    select.innerHTML = '';

    if (!options.length) {
      var emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = emptyText;
      select.appendChild(emptyOption);
      return '';
    }

    for (var i = 0; i < options.length; i++) {
      var option = document.createElement('option');
      option.value = String(options[i].id);
      option.textContent = getLabel(options[i]);
      select.appendChild(option);
    }

    if (selectedId && options.some(function (item) { return String(item.id) === String(selectedId); })) {
      select.value = String(selectedId);
    } else {
      select.selectedIndex = 0;
    }

    return select.value || '';
  }

  function guildLabel(guild) {
    return guild.name + ' (' + guild.id + ')';
  }

  function channelLabel(channel) {
    var prefix = channel.type === 'announcement' ? '[ANN] ' : '#';
    return prefix + channel.name + ' (' + channel.id + ')';
  }

  function telegramChatLabel(chat) {
    var type = '[' + (chat.type || 'unknown') + '] ';
    var source = chat.source === 'updates' ? ' - recent' : (chat.source === 'configured' ? ' - configured' : '');
    return type + chat.title + ' (' + chat.id + ')' + source;
  }

  function refreshDiscordSourceGuildSelect() {
    var filteredGuilds = filterOptions(setupState.guilds, discordSourceServerSearch ? discordSourceServerSearch.value : '', guildLabel);
    setupState.discordSourceGuildId = setSelectOptions(
      discordSourceServerSelect,
      filteredGuilds,
      guildLabel,
      'No source servers found',
      setupState.discordSourceGuildId
    );
    refreshDiscordSourceChannelSelect();
  }

  function refreshDiscordSourceChannelSelect() {
    var guild = getGuildById(setupState.discordSourceGuildId);
    var channels = guild ? (guild.sourceChannels || []) : [];
    var filteredChannels = filterOptions(channels, discordSourceChannelSearch ? discordSourceChannelSearch.value : '', channelLabel);
    setSelectOptions(
      discordSourceChannelSelect,
      filteredChannels,
      channelLabel,
      'No source channels found',
      discordSourceChannelSelect ? discordSourceChannelSelect.value : ''
    );
  }

  function refreshDiscordTargetGuildSelect() {
    var filteredGuilds = filterOptions(setupState.guilds, discordTargetServerSearch ? discordTargetServerSearch.value : '', guildLabel);
    setupState.discordTargetGuildId = setSelectOptions(
      discordTargetServerSelect,
      filteredGuilds,
      guildLabel,
      'No target servers found',
      setupState.discordTargetGuildId
    );
    refreshDiscordTargetChannelSelect();
  }

  function refreshDiscordTargetChannelSelect() {
    var guild = getGuildById(setupState.discordTargetGuildId);
    var channels = guild ? (guild.targetChannels || []) : [];
    var filteredChannels = filterOptions(channels, discordTargetChannelSearch ? discordTargetChannelSearch.value : '', channelLabel);
    setSelectOptions(
      discordTargetChannelSelect,
      filteredChannels,
      channelLabel,
      'No writable target channels found',
      discordTargetChannelSelect ? discordTargetChannelSelect.value : ''
    );
  }

  function refreshTelegramSourceGuildSelect() {
    var filteredGuilds = filterOptions(setupState.guilds, telegramSourceServerSearch ? telegramSourceServerSearch.value : '', guildLabel);
    setupState.telegramSourceGuildId = setSelectOptions(
      telegramSourceServerSelect,
      filteredGuilds,
      guildLabel,
      'No source servers found',
      setupState.telegramSourceGuildId
    );
    refreshTelegramSourceChannelSelect();
  }

  function refreshTelegramSourceChannelSelect() {
    var guild = getGuildById(setupState.telegramSourceGuildId);
    var channels = guild ? (guild.sourceChannels || []) : [];
    var filteredChannels = filterOptions(channels, telegramSourceChannelSearch ? telegramSourceChannelSearch.value : '', channelLabel);
    setSelectOptions(
      telegramSourceChannelSelect,
      filteredChannels,
      channelLabel,
      'No source channels found',
      telegramSourceChannelSelect ? telegramSourceChannelSelect.value : ''
    );
  }

  function refreshTelegramChatSelect() {
    var chats = Array.isArray(setupState.telegram.chats) ? setupState.telegram.chats : [];
    var filteredChats = filterOptions(chats, telegramChatSearch ? telegramChatSearch.value : '', telegramChatLabel);
    setSelectOptions(
      telegramChatSelect,
      filteredChats,
      telegramChatLabel,
      'No discovered chats (manual ID still works)',
      telegramChatSelect ? telegramChatSelect.value : ''
    );
  }

  function refreshTelegramHint() {
    if (!telegramChatHint) return;
    if (!setupState.telegram.enabled) {
      telegramChatHint.textContent = 'Telegram integration is currently disabled. Manual chat ID entry is still available.';
      return;
    }

    var warnings = Array.isArray(setupState.telegram.warnings) ? setupState.telegram.warnings : [];
    if (!warnings.length) {
      telegramChatHint.textContent = 'Chat list uses best-effort discovery from bot updates and existing configs.';
      return;
    }

    telegramChatHint.textContent = 'Discovery warnings: ' + warnings.join(' | ');
  }

  function renderSetupSelectors() {
    refreshDiscordSourceGuildSelect();
    refreshDiscordTargetGuildSelect();
    refreshTelegramSourceGuildSelect();
    refreshTelegramChatSelect();
    refreshTelegramHint();
  }

  async function loadSetupOptions(forceReload) {
    if (setupState.loading) return;
    if (setupState.loaded && !forceReload) return;

    setupState.loading = true;
    try {
      var payload = await AdminApp.fetchJson('/api/form-options');
      setupState.guilds = Array.isArray(payload.guilds) ? payload.guilds : [];
      setupState.telegram = payload.telegram || { enabled: false, chats: [], warnings: [] };

      var preferredGuild = AdminApp.state.currentGuildId || '';
      if (!preferredGuild && setupState.guilds.length) {
        preferredGuild = setupState.guilds[0].id;
      }

      if (preferredGuild && getGuildById(preferredGuild)) {
        setupState.discordSourceGuildId = preferredGuild;
        setupState.discordTargetGuildId = preferredGuild;
        setupState.telegramSourceGuildId = preferredGuild;
      } else if (setupState.guilds.length) {
        setupState.discordSourceGuildId = setupState.guilds[0].id;
        setupState.discordTargetGuildId = setupState.guilds[0].id;
        setupState.telegramSourceGuildId = setupState.guilds[0].id;
      } else {
        setupState.discordSourceGuildId = '';
        setupState.discordTargetGuildId = '';
        setupState.telegramSourceGuildId = '';
      }

      setupState.loaded = true;
      renderSetupSelectors();
    } catch (error) {
      AdminApp.setStatus('Failed to load setup options: ' + error.message, true);
    } finally {
      setupState.loading = false;
    }
  }

  function syncSourceGuildToCurrentSelection(guildId) {
    if (!setupState.loaded || !guildId) return;
    if (!getGuildById(guildId)) return;

    setupState.discordSourceGuildId = guildId;
    setupState.telegramSourceGuildId = guildId;
    if (!setupState.discordTargetGuildId) {
      setupState.discordTargetGuildId = guildId;
    }

    renderSetupSelectors();
  }

  function isDiscordId(value) {
    return /^\d+$/.test(String(value || '').trim());
  }

  function isTelegramChatId(value) {
    return /^-?\d+$/.test(String(value || '').trim());
  }

  function wireSearchAndSelectEvents() {
    if (discordSourceServerSearch) {
      discordSourceServerSearch.addEventListener('input', refreshDiscordSourceGuildSelect);
    }
    if (discordSourceServerSelect) {
      discordSourceServerSelect.addEventListener('change', function () {
        setupState.discordSourceGuildId = discordSourceServerSelect.value;
        refreshDiscordSourceChannelSelect();
      });
    }
    if (discordSourceChannelSearch) {
      discordSourceChannelSearch.addEventListener('input', refreshDiscordSourceChannelSelect);
    }

    if (discordTargetServerSearch) {
      discordTargetServerSearch.addEventListener('input', refreshDiscordTargetGuildSelect);
    }
    if (discordTargetServerSelect) {
      discordTargetServerSelect.addEventListener('change', function () {
        setupState.discordTargetGuildId = discordTargetServerSelect.value;
        refreshDiscordTargetChannelSelect();
      });
    }
    if (discordTargetChannelSearch) {
      discordTargetChannelSearch.addEventListener('input', refreshDiscordTargetChannelSelect);
    }

    if (telegramSourceServerSearch) {
      telegramSourceServerSearch.addEventListener('input', refreshTelegramSourceGuildSelect);
    }
    if (telegramSourceServerSelect) {
      telegramSourceServerSelect.addEventListener('change', function () {
        setupState.telegramSourceGuildId = telegramSourceServerSelect.value;
        refreshTelegramSourceChannelSelect();
      });
    }
    if (telegramSourceChannelSearch) {
      telegramSourceChannelSearch.addEventListener('input', refreshTelegramSourceChannelSelect);
    }
    if (telegramChatSearch) {
      telegramChatSearch.addEventListener('input', refreshTelegramChatSelect);
    }
    if (telegramChatSelect) {
      telegramChatSelect.addEventListener('change', function () {
        if (!telegramChatIdInput) return;
        if (!telegramChatSelect.value) return;
        telegramChatIdInput.value = telegramChatSelect.value;
      });
    }
  }

  if (createDiscordForm) {
    createDiscordForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      await loadSetupOptions(false);

      var sourceGuildId = String(discordSourceServerSelect ? discordSourceServerSelect.value : '').trim();
      var sourceChannelId = String(discordSourceChannelSelect ? discordSourceChannelSelect.value : '').trim();
      var targetServerId = String(discordTargetServerSelect ? discordTargetServerSelect.value : '').trim();
      var targetChannelId = String(discordTargetChannelSelect ? discordTargetChannelSelect.value : '').trim();

      if (!isDiscordId(sourceGuildId) || !isDiscordId(sourceChannelId) || !isDiscordId(targetServerId) || !isDiscordId(targetChannelId)) {
        AdminApp.setStatus('Select valid source and target server/channel values.', true);
        return;
      }

      var payload = {
        guildId: sourceGuildId,
        targetType: 'discord',
        sourceChannelId: sourceChannelId,
        targetChannelId: targetChannelId,
        targetServerId: targetServerId,
        name: document.getElementById('discord-name').value.trim()
      };

      try {
        AdminApp.setStatus('Creating Discord forward...');
        await AdminApp.fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        document.getElementById('discord-name').value = '';
        AdminApp.setStatus('Discord forward created.');
        await loadConfigs(AdminApp.state.currentGuildId);
      } catch (error) {
        AdminApp.setStatus('Create failed: ' + error.message, true);
      }
    });
  }

  if (createTelegramForm) {
    createTelegramForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      await loadSetupOptions(false);

      var sourceGuildId = String(telegramSourceServerSelect ? telegramSourceServerSelect.value : '').trim();
      var sourceChannelId = String(telegramSourceChannelSelect ? telegramSourceChannelSelect.value : '').trim();
      var selectedChatId = String(telegramChatSelect ? telegramChatSelect.value : '').trim();
      var typedChatId = String(telegramChatIdInput ? telegramChatIdInput.value : '').trim();
      var targetChatId = typedChatId || selectedChatId;

      if (!isDiscordId(sourceGuildId) || !isDiscordId(sourceChannelId)) {
        AdminApp.setStatus('Select valid source server and source channel values.', true);
        return;
      }
      if (!isTelegramChatId(targetChatId)) {
        AdminApp.setStatus('Select or enter a valid Telegram chat ID.', true);
        return;
      }

      var payload = {
        guildId: sourceGuildId,
        targetType: 'telegram',
        sourceChannelId: sourceChannelId,
        targetChatId: targetChatId,
        name: document.getElementById('telegram-name').value.trim()
      };

      try {
        AdminApp.setStatus('Creating Telegram forward...');
        await AdminApp.fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        document.getElementById('telegram-name').value = '';
        AdminApp.setStatus('Telegram forward created.');
        await loadConfigs(AdminApp.state.currentGuildId);
      } catch (error) {
        AdminApp.setStatus('Create failed: ' + error.message, true);
      }
    });
  }

  wireSearchAndSelectEvents();

  AdminApp.onTabActivate('configs', function () {
    loadConfigs(AdminApp.state.currentGuildId);
    loadSetupOptions(false);
  });

  AdminApp.onGuildChange(function (guildId) {
    loadConfigs(guildId);
    syncSourceGuildToCurrentSelection(guildId);
  });
})();
