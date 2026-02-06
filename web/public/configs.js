/* configs.js -- Forward configuration management tab */
(function () {
  'use strict';

  var configsBody = document.getElementById('configs-body');
  var createDiscordForm = document.getElementById('create-discord-form');
  var createTelegramForm = document.getElementById('create-telegram-form');

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

      // Toggle button
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

        // Remove button
        var removeButton = document.createElement('button');
        removeButton.className = 'button secondary sm danger';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', async function () {
          var confirmed = confirm('Remove config ' + cfg.id + '?');
          if (!confirmed) return;
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

        // Test Telegram button
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
    } catch (error) {
      setConfigsMessage('Failed to load configurations.');
    }
  }

  // -- Form submissions --
  if (createDiscordForm) {
    createDiscordForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!AdminApp.state.currentGuildId) {
        AdminApp.setStatus('Select a guild first.', true);
        return;
      }

      var payload = {
        guildId: AdminApp.state.currentGuildId,
        targetType: 'discord',
        sourceChannelId: document.getElementById('discord-source-channel').value.trim(),
        targetChannelId: document.getElementById('discord-target-channel').value.trim(),
        targetServerId: document.getElementById('discord-target-server').value.trim(),
        name: document.getElementById('discord-name').value.trim()
      };

      try {
        AdminApp.setStatus('Creating Discord forward...');
        await AdminApp.fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        createDiscordForm.reset();
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
      if (!AdminApp.state.currentGuildId) {
        AdminApp.setStatus('Select a guild first.', true);
        return;
      }

      var payload = {
        guildId: AdminApp.state.currentGuildId,
        targetType: 'telegram',
        sourceChannelId: document.getElementById('telegram-source-channel').value.trim(),
        targetChatId: document.getElementById('telegram-chat-id').value.trim(),
        name: document.getElementById('telegram-name').value.trim()
      };

      try {
        AdminApp.setStatus('Creating Telegram forward...');
        await AdminApp.fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        createTelegramForm.reset();
        AdminApp.setStatus('Telegram forward created.');
        await loadConfigs(AdminApp.state.currentGuildId);
      } catch (error) {
        AdminApp.setStatus('Create failed: ' + error.message, true);
      }
    });
  }

  // -- Tab activation --
  AdminApp.onTabActivate('configs', function () {
    loadConfigs(AdminApp.state.currentGuildId);
  });

  AdminApp.onGuildChange(function (guildId) {
    loadConfigs(guildId);
  });
})();
