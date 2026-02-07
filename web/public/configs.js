/* configs.js -- Forward configuration management tab */
(function () {
  'use strict';

  var configsBody = document.getElementById('configs-body');
  var createDiscordForm = document.getElementById('create-discord-form');
  var createTelegramForm = document.getElementById('create-telegram-form');

  var discordSourceServerSearch = document.getElementById('discord-source-server-search');
  var discordSourceServerSelect = document.getElementById('discord-source-server');
  var discordSourceBotSelect = document.getElementById('discord-source-bot');
  var discordSourceChannelSearch = document.getElementById('discord-source-channel-search');
  var discordSourceChannelSelect = document.getElementById('discord-source-channel');
  var discordTargetServerSearch = document.getElementById('discord-target-server-search');
  var discordTargetServerSelect = document.getElementById('discord-target-server');
  var discordTargetChannelSearch = document.getElementById('discord-target-channel-search');
  var discordTargetChannelSelect = document.getElementById('discord-target-channel');

  var telegramSourceServerSearch = document.getElementById('telegram-source-server-search');
  var telegramSourceServerSelect = document.getElementById('telegram-source-server');
  var telegramSourceBotSelect = document.getElementById('telegram-source-bot');
  var telegramSourceChannelSearch = document.getElementById('telegram-source-channel-search');
  var telegramSourceChannelSelect = document.getElementById('telegram-source-channel');
  var telegramChatSearch = document.getElementById('telegram-chat-search');
  var telegramChatSelect = document.getElementById('telegram-chat-select');
  var telegramChatIdInput = document.getElementById('telegram-chat-id');
  var telegramChatHint = document.getElementById('telegram-chat-hint');
  var telegramChatRemoveBtn = document.getElementById('telegram-chat-remove-btn');

  var setupState = {
    loaded: false,
    loading: false,
    sourceGuilds: [],
    targetGuilds: [],
    telegram: {
      enabled: false,
      chats: [],
      warnings: []
    },
    discordSourceGuildId: '',
    discordSourceBot: 'main',
    discordTargetGuildId: '',
    telegramSourceGuildId: '',
    telegramSourceBot: 'main'
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
      var label = 'Telegram ';
      if (config.telegramChatTitle && config.telegramChatTitle !== 'Configured Chat') {
        label += config.telegramChatTitle + ' (' + config.targetChatId + ')';
      } else {
        label += config.targetChatId;
      }
      if (config.targetStatus === 'unreachable') {
        label += ' [Bot removed]';
      }
      return label;
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
      var sourceLabel = (config.useReaderBot ? '[Reader] ' : '[Main] ') + (config.sourceChannelId || '-');
      row.appendChild(createCell(sourceLabel));
      var targetCell = createCell(targetText(config));
      if (config.targetStatus === 'unreachable') {
        targetCell.classList.add('text-danger');
      }
      row.appendChild(targetCell);
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
          var confirmed = await AdminApp.showConfirm(
            'Remove Config',
            'Remove config ' + cfg.id + '?',
            'Remove'
          );
          if (!confirmed) return;
          try {
            AdminApp.setStatus('Removing config ' + cfg.id + '...');
            var result = await AdminApp.fetchJson('/api/configs/' + cfg.id, { method: 'DELETE' });
            var deletedLogs = Number(result.deletedLogs || 0);
            AdminApp.setStatus(
              'Config ' + cfg.id + ' removed. Cleaned ' + deletedLogs + ' related log entr' +
              (deletedLogs === 1 ? 'y' : 'ies') + '.'
            );
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

  function getGuildById(guilds, guildId) {
    var list = Array.isArray(guilds) ? guilds : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === guildId) return list[i];
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
    if (typeof select.size === 'number' && select.size !== 1) {
      select.size = 1;
    }
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

  function getSourceBotOptionsForGuild(guild) {
    var options = [];
    if (!guild || !guild.sourceBots) return options;

    if (guild.sourceBots.main && guild.sourceBots.main.available) {
      options.push({ id: 'main', label: 'Main Bot' });
    }
    if (guild.sourceBots.reader && guild.sourceBots.reader.available) {
      options.push({ id: 'reader', label: 'Reader Bot' });
    }

    return options;
  }

  function resolveSourceBotForGuild(guild, preferredSourceBot) {
    var options = getSourceBotOptionsForGuild(guild);
    if (!options.length) return 'main';

    var normalizedPreferred = String(preferredSourceBot || '').trim().toLowerCase();
    if (normalizedPreferred && options.some(function (opt) { return opt.id === normalizedPreferred; })) {
      return normalizedPreferred;
    }

    var defaultSourceBot = String(guild && guild.defaultSourceBot ? guild.defaultSourceBot : '').trim().toLowerCase();
    if (defaultSourceBot && options.some(function (opt) { return opt.id === defaultSourceBot; })) {
      return defaultSourceBot;
    }

    return options[0].id;
  }

  function getSourceChannelsForGuild(guild, sourceBot) {
    if (!guild) return [];
    var normalizedBot = resolveSourceBotForGuild(guild, sourceBot);
    if (guild.sourceBots && guild.sourceBots[normalizedBot]) {
      return guild.sourceBots[normalizedBot].sourceChannels || [];
    }
    return guild.sourceChannels || [];
  }

  function setSourceBotSelectOptions(select, guild, preferredSourceBot) {
    if (!select) return 'main';

    var botOptions = getSourceBotOptionsForGuild(guild);
    select.innerHTML = '';

    if (!botOptions.length) {
      var emptyOption = document.createElement('option');
      emptyOption.value = 'main';
      emptyOption.textContent = 'Main Bot';
      select.appendChild(emptyOption);
      select.disabled = true;
      return 'main';
    }

    for (var i = 0; i < botOptions.length; i++) {
      var option = document.createElement('option');
      option.value = botOptions[i].id;
      option.textContent = botOptions[i].label;
      select.appendChild(option);
    }

    var selectedSourceBot = resolveSourceBotForGuild(guild, preferredSourceBot);
    select.value = selectedSourceBot;
    select.disabled = botOptions.length <= 1;
    return selectedSourceBot;
  }

  function telegramChatLabel(chat) {
    var type = '[' + String(chat.type || 'unknown') + ']';
    var sourceMap = { tracked: 'tracked', updates: 'recent', configured: 'configured', forward: 'forward' };
    var source = sourceMap[chat.source] || '';
    var id = String(chat.id || '').trim();
    var title = String(chat.title || '').trim();
    if (!title || title === 'Configured Chat') {
      title = id ? ('Chat ' + id) : 'Chat';
    }

    var includesId = Boolean(id) && title.indexOf(id) >= 0;

    var parts = [type, title];
    if (id && !includesId) {
      parts.push('(' + id + ')');
    }
    if (source) {
      parts.push('- ' + source);
    }
    return parts.join(' ');
  }

  function wireExpandableSelect(select, maxVisibleRows) {
    if (!select) return;
    var expanded = false;
    var rowLimit = Math.max(2, Number(maxVisibleRows) || 8);

    function collapse() {
      if (!expanded) return;
      expanded = false;
      select.size = 1;
      select.classList.remove('select-expanded');
    }

    function expand() {
      if (expanded) return;
      var optionCount = select.options ? select.options.length : 0;
      if (optionCount <= 1) return;
      expanded = true;
      select.size = Math.min(rowLimit, optionCount);
      select.classList.add('select-expanded');
    }

    select.addEventListener('focus', expand);
    select.addEventListener('blur', collapse);
    select.addEventListener('change', collapse);
    select.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        collapse();
      }
    });
  }

  function refreshDiscordSourceGuildSelect() {
    var filteredGuilds = filterOptions(setupState.sourceGuilds, discordSourceServerSearch ? discordSourceServerSearch.value : '', guildLabel);
    setupState.discordSourceGuildId = setSelectOptions(
      discordSourceServerSelect,
      filteredGuilds,
      guildLabel,
      'No source servers found',
      setupState.discordSourceGuildId
    );
    refreshDiscordSourceBotSelect();
    refreshDiscordSourceChannelSelect();
  }

  function refreshDiscordSourceBotSelect() {
    var guild = getGuildById(setupState.sourceGuilds, setupState.discordSourceGuildId);
    setupState.discordSourceBot = setSourceBotSelectOptions(
      discordSourceBotSelect,
      guild,
      setupState.discordSourceBot
    );
  }

  function refreshDiscordSourceChannelSelect() {
    var guild = getGuildById(setupState.sourceGuilds, setupState.discordSourceGuildId);
    var channels = guild ? getSourceChannelsForGuild(guild, setupState.discordSourceBot) : [];
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
    var filteredGuilds = filterOptions(setupState.targetGuilds, discordTargetServerSearch ? discordTargetServerSearch.value : '', guildLabel);
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
    var guild = getGuildById(setupState.targetGuilds, setupState.discordTargetGuildId);
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
    var filteredGuilds = filterOptions(setupState.sourceGuilds, telegramSourceServerSearch ? telegramSourceServerSearch.value : '', guildLabel);
    setupState.telegramSourceGuildId = setSelectOptions(
      telegramSourceServerSelect,
      filteredGuilds,
      guildLabel,
      'No source servers found',
      setupState.telegramSourceGuildId
    );
    refreshTelegramSourceBotSelect();
    refreshTelegramSourceChannelSelect();
  }

  function refreshTelegramSourceBotSelect() {
    var guild = getGuildById(setupState.sourceGuilds, setupState.telegramSourceGuildId);
    setupState.telegramSourceBot = setSourceBotSelectOptions(
      telegramSourceBotSelect,
      guild,
      setupState.telegramSourceBot
    );
  }

  function refreshTelegramSourceChannelSelect() {
    var guild = getGuildById(setupState.sourceGuilds, setupState.telegramSourceGuildId);
    var channels = guild ? getSourceChannelsForGuild(guild, setupState.telegramSourceBot) : [];
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
    setTelegramTrackedActionsState();
  }

  function setTelegramTrackedActionsState() {
    if (!telegramChatRemoveBtn || !telegramChatSelect) return;
    telegramChatRemoveBtn.disabled = !String(telegramChatSelect.value || '').trim();
  }

  function refreshTelegramHint() {
    if (!telegramChatHint) return;
    if (!setupState.telegram.enabled) {
      telegramChatHint.textContent = 'Telegram integration is currently disabled. Manual target entry (Chat ID, @username, t.me link) is still available.';
      return;
    }

    var warnings = Array.isArray(setupState.telegram.warnings) ? setupState.telegram.warnings : [];
    if (!warnings.length) {
      telegramChatHint.textContent = 'Enter Chat ID, @username, or t.me link. You can also pick or remove tracked chats below.';
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
      setupState.sourceGuilds = Array.isArray(payload.sourceGuilds)
        ? payload.sourceGuilds
        : (Array.isArray(payload.guilds) ? payload.guilds : []);
      setupState.targetGuilds = Array.isArray(payload.targetGuilds)
        ? payload.targetGuilds
        : setupState.sourceGuilds.filter(function (guild) {
          return Array.isArray(guild.targetChannels) && guild.targetChannels.length > 0;
        }).map(function (guild) {
          return {
            id: guild.id,
            name: guild.name,
            targetChannels: guild.targetChannels || []
          };
        });
      setupState.telegram = payload.telegram || { enabled: false, chats: [], warnings: [] };

      var preferredGuild = AdminApp.state.currentGuildId || '';
      if (!preferredGuild && setupState.sourceGuilds.length) {
        preferredGuild = setupState.sourceGuilds[0].id;
      }
      var preferredTargetGuild = AdminApp.state.currentGuildId || '';
      if (!preferredTargetGuild && setupState.targetGuilds.length) {
        preferredTargetGuild = setupState.targetGuilds[0].id;
      }

      if (preferredGuild && getGuildById(setupState.sourceGuilds, preferredGuild)) {
        setupState.discordSourceGuildId = preferredGuild;
        setupState.telegramSourceGuildId = preferredGuild;
      } else if (setupState.sourceGuilds.length) {
        setupState.discordSourceGuildId = setupState.sourceGuilds[0].id;
        setupState.telegramSourceGuildId = setupState.sourceGuilds[0].id;
      } else {
        setupState.discordSourceGuildId = '';
        setupState.telegramSourceGuildId = '';
      }

      var selectedDiscordSourceGuild = getGuildById(setupState.sourceGuilds, setupState.discordSourceGuildId);
      var selectedTelegramSourceGuild = getGuildById(setupState.sourceGuilds, setupState.telegramSourceGuildId);
      setupState.discordSourceBot = resolveSourceBotForGuild(selectedDiscordSourceGuild, setupState.discordSourceBot);
      setupState.telegramSourceBot = resolveSourceBotForGuild(selectedTelegramSourceGuild, setupState.telegramSourceBot);

      if (preferredTargetGuild && getGuildById(setupState.targetGuilds, preferredTargetGuild)) {
        setupState.discordTargetGuildId = preferredTargetGuild;
      } else if (setupState.targetGuilds.length) {
        setupState.discordTargetGuildId = setupState.targetGuilds[0].id;
      } else {
        setupState.discordTargetGuildId = '';
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
    if (!getGuildById(setupState.sourceGuilds, guildId)) return;

    setupState.discordSourceGuildId = guildId;
    setupState.telegramSourceGuildId = guildId;
    var guild = getGuildById(setupState.sourceGuilds, guildId);
    setupState.discordSourceBot = resolveSourceBotForGuild(guild, setupState.discordSourceBot);
    setupState.telegramSourceBot = resolveSourceBotForGuild(guild, setupState.telegramSourceBot);
    if (!setupState.discordTargetGuildId && getGuildById(setupState.targetGuilds, guildId)) {
      setupState.discordTargetGuildId = guildId;
    }

    renderSetupSelectors();
  }

  function getFirstId(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return String(items[0].id || '');
  }

  function setActiveGuild(guildId) {
    var nextGuildId = String(guildId || '').trim();
    if (!nextGuildId) return;

    var guildSelect = document.getElementById('guild-select');
    if (!guildSelect) {
      loadConfigs(nextGuildId);
      return;
    }

    if (guildSelect.value !== nextGuildId) {
      guildSelect.value = nextGuildId;
      guildSelect.dispatchEvent(new Event('change'));
      return;
    }

    loadConfigs(nextGuildId);
  }

  function resetDiscordCreateForm() {
    if (discordSourceServerSearch) discordSourceServerSearch.value = '';
    if (discordSourceChannelSearch) discordSourceChannelSearch.value = '';
    if (discordTargetServerSearch) discordTargetServerSearch.value = '';
    if (discordTargetChannelSearch) discordTargetChannelSearch.value = '';

    setupState.discordSourceGuildId = getFirstId(setupState.sourceGuilds);
    var guild = getGuildById(setupState.sourceGuilds, setupState.discordSourceGuildId);
    setupState.discordSourceBot = resolveSourceBotForGuild(guild, setupState.discordSourceBot);
    setupState.discordTargetGuildId = getFirstId(setupState.targetGuilds);
    renderSetupSelectors();

    var discordNameInput = document.getElementById('discord-name');
    if (discordNameInput) discordNameInput.value = '';
  }

  function resetTelegramCreateForm() {
    if (telegramSourceServerSearch) telegramSourceServerSearch.value = '';
    if (telegramSourceChannelSearch) telegramSourceChannelSearch.value = '';
    if (telegramChatSearch) telegramChatSearch.value = '';
    if (telegramChatSelect) telegramChatSelect.value = '';
    if (telegramChatIdInput) telegramChatIdInput.value = '';

    setupState.telegramSourceGuildId = getFirstId(setupState.sourceGuilds);
    var guild = getGuildById(setupState.sourceGuilds, setupState.telegramSourceGuildId);
    setupState.telegramSourceBot = resolveSourceBotForGuild(guild, setupState.telegramSourceBot);
    renderSetupSelectors();

    var telegramNameInput = document.getElementById('telegram-name');
    if (telegramNameInput) telegramNameInput.value = '';
  }

  function isDiscordId(value) {
    return /^\d+$/.test(String(value || '').trim());
  }

  function isTelegramChatInput(value) {
    var raw = String(value || '').trim();
    if (!raw) return false;
    if (/^-?\d+$/.test(raw)) return true;

    var candidate = raw;
    var resolveMatch = candidate.match(/^tg:\/\/resolve\?domain=([A-Za-z0-9_]{4,32})/i);
    if (resolveMatch) {
      candidate = resolveMatch[1];
    } else {
      candidate = candidate
        .replace(/^https?:\/\/t\.me\//i, '')
        .replace(/^t\.me\//i, '')
        .replace(/^@/, '');

      var slashIndex = candidate.indexOf('/');
      if (slashIndex >= 0) {
        candidate = candidate.slice(0, slashIndex);
      }

      var queryIndex = candidate.indexOf('?');
      if (queryIndex >= 0) {
        candidate = candidate.slice(0, queryIndex);
      }

      candidate = candidate.trim();
    }

    return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(candidate);
  }

  async function removeSelectedTrackedTelegramChat() {
    var selectedChatId = String(telegramChatSelect ? telegramChatSelect.value : '').trim();
    if (!selectedChatId) {
      AdminApp.setStatus('Select a tracked Telegram chat to remove.', true);
      return;
    }

    var confirmed = await AdminApp.showConfirm(
      'Remove Tracked Telegram Chat',
      'Remove tracked Telegram chat ' + selectedChatId + ' from this list?',
      'Remove'
    );
    if (!confirmed) {
      return;
    }

    try {
      if (telegramChatRemoveBtn) {
        telegramChatRemoveBtn.disabled = true;
        telegramChatRemoveBtn.textContent = 'Removing...';
      }

      await AdminApp.fetchJson('/api/telegram-chats/' + encodeURIComponent(selectedChatId), {
        method: 'DELETE'
      });

      if (telegramChatIdInput && String(telegramChatIdInput.value || '').trim() === selectedChatId) {
        telegramChatIdInput.value = '';
      }

      AdminApp.setStatus('Tracked Telegram chat removed: ' + selectedChatId);
      await loadSetupOptions(true);
    } catch (error) {
      AdminApp.setStatus('Failed to remove tracked chat: ' + error.message, true);
    } finally {
      if (telegramChatRemoveBtn) {
        telegramChatRemoveBtn.textContent = 'Remove Selected Tracked Chat';
      }
      setTelegramTrackedActionsState();
    }
  }

  function wireSearchAndSelectEvents() {
    if (discordSourceServerSearch) {
      discordSourceServerSearch.addEventListener('input', refreshDiscordSourceGuildSelect);
    }
    if (discordSourceServerSelect) {
      discordSourceServerSelect.addEventListener('change', function () {
        setupState.discordSourceGuildId = discordSourceServerSelect.value;
        refreshDiscordSourceBotSelect();
        refreshDiscordSourceChannelSelect();
      });
    }
    if (discordSourceBotSelect) {
      discordSourceBotSelect.addEventListener('change', function () {
        setupState.discordSourceBot = String(discordSourceBotSelect.value || 'main').trim().toLowerCase();
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
        refreshTelegramSourceBotSelect();
        refreshTelegramSourceChannelSelect();
      });
    }
    if (telegramSourceBotSelect) {
      telegramSourceBotSelect.addEventListener('change', function () {
        setupState.telegramSourceBot = String(telegramSourceBotSelect.value || 'main').trim().toLowerCase();
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
      wireExpandableSelect(telegramChatSelect, 8);
      telegramChatSelect.addEventListener('change', function () {
        setTelegramTrackedActionsState();
        if (!telegramChatIdInput) return;
        if (!telegramChatSelect.value) return;
        telegramChatIdInput.value = telegramChatSelect.value;
      });
    }
    if (telegramChatRemoveBtn) {
      setTelegramTrackedActionsState();
      telegramChatRemoveBtn.addEventListener('click', function () {
        removeSelectedTrackedTelegramChat();
      });
    }

  }

  if (createDiscordForm) {
    createDiscordForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      await loadSetupOptions(false);

      var sourceGuildId = String(discordSourceServerSelect ? discordSourceServerSelect.value : '').trim();
      var sourceBot = String(discordSourceBotSelect ? discordSourceBotSelect.value : setupState.discordSourceBot || 'main').trim().toLowerCase();
      var sourceChannelId = String(discordSourceChannelSelect ? discordSourceChannelSelect.value : '').trim();
      var targetServerId = String(discordTargetServerSelect ? discordTargetServerSelect.value : '').trim();
      var targetChannelId = String(discordTargetChannelSelect ? discordTargetChannelSelect.value : '').trim();

      if (!isDiscordId(sourceGuildId) || !isDiscordId(sourceChannelId) || !isDiscordId(targetServerId) || !isDiscordId(targetChannelId)) {
        AdminApp.setStatus('Select valid source and target server/channel values.', true);
        return;
      }

      var payload = {
        guildId: sourceGuildId,
        sourceBot: sourceBot,
        targetType: 'discord',
        sourceChannelId: sourceChannelId,
        targetChannelId: targetChannelId,
        targetServerId: targetServerId,
        name: document.getElementById('discord-name').value.trim()
      };

      try {
        AdminApp.setStatus('Creating Discord forward...');
        var createdDiscord = await AdminApp.fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        resetDiscordCreateForm();
        var discordConfigId = createdDiscord && createdDiscord.config ? createdDiscord.config.id : '?';
        AdminApp.setStatus('Discord forward created successfully (Config ' + discordConfigId + ').');
        setActiveGuild(sourceGuildId);
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
      var sourceBot = String(telegramSourceBotSelect ? telegramSourceBotSelect.value : setupState.telegramSourceBot || 'main').trim().toLowerCase();
      var sourceChannelId = String(telegramSourceChannelSelect ? telegramSourceChannelSelect.value : '').trim();
      var selectedChatId = String(telegramChatSelect ? telegramChatSelect.value : '').trim();
      var typedChatId = String(telegramChatIdInput ? telegramChatIdInput.value : '').trim();
      var targetChatId = typedChatId || selectedChatId;

      if (!isDiscordId(sourceGuildId) || !isDiscordId(sourceChannelId)) {
        AdminApp.setStatus('Select valid source server and source channel values.', true);
        return;
      }
      if (!isTelegramChatInput(targetChatId)) {
        AdminApp.setStatus('Select or enter a valid Telegram chat ID, @username, or t.me link.', true);
        return;
      }

      // Step 1: Verify bot has access to the target chat
      try {
        AdminApp.setStatus('Verifying bot access to Telegram chat...');
        await AdminApp.fetchJson('/api/telegram-chats/verify', {
          method: 'POST',
          body: JSON.stringify({ chatId: targetChatId })
        });
      } catch (verifyError) {
        AdminApp.setStatus('Cannot create forward: ' + (verifyError.message || 'Bot does not have access to this chat.'), true);
        return;
      }

      // Step 2: Create the forward config
      var payload = {
        guildId: sourceGuildId,
        sourceBot: sourceBot,
        targetType: 'telegram',
        sourceChannelId: sourceChannelId,
        targetChatId: targetChatId,
        name: document.getElementById('telegram-name').value.trim()
      };

      try {
        AdminApp.setStatus('Creating Telegram forward...');
        var createdTelegram = await AdminApp.fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        resetTelegramCreateForm();
        await loadSetupOptions(true);
        var telegramConfigId = createdTelegram && createdTelegram.config ? createdTelegram.config.id : '?';
        AdminApp.setStatus('Telegram forward created successfully (Config ' + telegramConfigId + ').');
        setActiveGuild(sourceGuildId);
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
