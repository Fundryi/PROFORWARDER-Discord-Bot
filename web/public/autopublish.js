/* autopublish.js -- Auto publish management tab */
(function () {
  'use strict';

  var guildSearchInput = document.getElementById('autopublish-guild-search');
  var guildSelect = document.getElementById('autopublish-guild-select');
  var channelSearchInput = document.getElementById('autopublish-channel-search');
  var channelSelect = document.getElementById('autopublish-channel-select');
  var selectedStateBadge = document.getElementById('autopublish-selected-state');
  var toggleButton = document.getElementById('autopublish-toggle-btn');
  var refreshButton = document.getElementById('autopublish-refresh-btn');
  var enabledBody = document.getElementById('autopublish-enabled-body');

  var state = {
    loaded: false,
    loading: false,
    guilds: [],
    selectedGuildId: '',
    selectedChannelId: ''
  };

  function guildLabel(guild) {
    return guild.name + ' (' + guild.id + ')';
  }

  function channelLabel(channel) {
    return '# ' + channel.name + ' (' + channel.id + ')';
  }

  function filterOptions(options, query, getLabel) {
    var text = String(query || '').trim().toLowerCase();
    if (!text) return options.slice();

    return options.filter(function (item) {
      var label = getLabel(item).toLowerCase();
      return label.indexOf(text) >= 0 || String(item.id || '').toLowerCase().indexOf(text) >= 0;
    });
  }

  function setSelectOptions(select, options, getLabel, emptyText, selectedId) {
    if (!select) return '';
    select.innerHTML = '';

    if (!options.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = emptyText;
      select.appendChild(empty);
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

  function getGuildById(guildId) {
    for (var i = 0; i < state.guilds.length; i++) {
      if (state.guilds[i].id === guildId) return state.guilds[i];
    }
    return null;
  }

  function getSelectedChannel() {
    var guild = getGuildById(state.selectedGuildId);
    if (!guild) return null;
    var channels = Array.isArray(guild.channels) ? guild.channels : [];
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === state.selectedChannelId) return channels[i];
    }
    return null;
  }

  function setSelectedStateBadge(enabled) {
    if (!selectedStateBadge) return;
    selectedStateBadge.classList.remove('success', 'failed', 'retry');
    if (enabled === true) {
      selectedStateBadge.classList.add('success');
      selectedStateBadge.textContent = 'Enabled';
      return;
    }
    if (enabled === false) {
      selectedStateBadge.classList.add('failed');
      selectedStateBadge.textContent = 'Disabled';
      return;
    }
    selectedStateBadge.classList.add('retry');
    selectedStateBadge.textContent = 'Select a channel';
  }

  function renderEnabledTable() {
    if (!enabledBody) return;
    enabledBody.innerHTML = '';

    var enabledRows = [];
    for (var i = 0; i < state.guilds.length; i++) {
      var guild = state.guilds[i];
      var channels = Array.isArray(guild.channels) ? guild.channels : [];
      for (var j = 0; j < channels.length; j++) {
        if (!channels[j].enabled) continue;
        enabledRows.push({
          guildId: guild.id,
          guildName: guild.name,
          channelId: channels[j].id,
          channelName: channels[j].name
        });
      }
    }

    if (!enabledRows.length) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.className = 'muted-text';
      emptyCell.textContent = 'No auto-publish channels enabled.';
      emptyRow.appendChild(emptyCell);
      enabledBody.appendChild(emptyRow);
      return;
    }

    for (var k = 0; k < enabledRows.length; k++) {
      var rowData = enabledRows[k];
      var row = document.createElement('tr');

      var guildCell = document.createElement('td');
      guildCell.textContent = rowData.guildName;
      row.appendChild(guildCell);

      var channelCell = document.createElement('td');
      channelCell.textContent = '# ' + rowData.channelName;
      row.appendChild(channelCell);

      var idCell = document.createElement('td');
      idCell.className = 'mono';
      idCell.textContent = rowData.channelId;
      row.appendChild(idCell);

      var actionCell = document.createElement('td');
      var disableButton = document.createElement('button');
      disableButton.className = 'button secondary sm danger';
      disableButton.textContent = 'Disable';
      disableButton.setAttribute('data-guild-id', rowData.guildId);
      disableButton.setAttribute('data-channel-id', rowData.channelId);
      disableButton.setAttribute('data-enabled', 'false');
      actionCell.appendChild(disableButton);
      row.appendChild(actionCell);

      enabledBody.appendChild(row);
    }
  }

  function refreshGuildSelect() {
    var filteredGuilds = filterOptions(state.guilds, guildSearchInput ? guildSearchInput.value : '', guildLabel);
    state.selectedGuildId = setSelectOptions(
      guildSelect,
      filteredGuilds,
      guildLabel,
      'No manageable servers found',
      state.selectedGuildId
    );
    refreshChannelSelect();
  }

  function refreshChannelSelect() {
    var guild = getGuildById(state.selectedGuildId);
    var channels = guild ? (guild.channels || []) : [];
    var filteredChannels = filterOptions(channels, channelSearchInput ? channelSearchInput.value : '', channelLabel);
    state.selectedChannelId = setSelectOptions(
      channelSelect,
      filteredChannels,
      channelLabel,
      'No announcement channels found',
      state.selectedChannelId
    );
    refreshSelectedState();
  }

  function refreshSelectedState() {
    var channel = getSelectedChannel();
    if (!channel) {
      setSelectedStateBadge(null);
      if (toggleButton) {
        toggleButton.disabled = true;
        toggleButton.textContent = 'Enable';
      }
      return;
    }

    setSelectedStateBadge(Boolean(channel.enabled));
    if (toggleButton) {
      toggleButton.disabled = false;
      toggleButton.textContent = channel.enabled ? 'Disable' : 'Enable';
    }
  }

  function renderAll() {
    refreshGuildSelect();
    renderEnabledTable();
  }

  async function loadAutoPublishData(forceReload) {
    if (state.loading) return;
    if (state.loaded && !forceReload) return;

    state.loading = true;
    var previousGuildId = state.selectedGuildId;
    var previousChannelId = state.selectedChannelId;

    try {
      var payload = await AdminApp.fetchJson('/api/auto-publish');
      state.guilds = Array.isArray(payload.guilds) ? payload.guilds : [];

      var preferredGuildId = previousGuildId || AdminApp.state.currentGuildId || '';
      if (!preferredGuildId && state.guilds.length) preferredGuildId = state.guilds[0].id;
      state.selectedGuildId = preferredGuildId;

      var guild = getGuildById(state.selectedGuildId);
      var channels = guild ? (guild.channels || []) : [];
      if (previousChannelId && channels.some(function (item) { return item.id === previousChannelId; })) {
        state.selectedChannelId = previousChannelId;
      } else {
        state.selectedChannelId = channels.length ? channels[0].id : '';
      }

      state.loaded = true;
      renderAll();
    } catch (error) {
      AdminApp.setStatus('Failed to load auto-publish data: ' + error.message, true);
      if (enabledBody) {
        enabledBody.innerHTML = '<tr><td colspan="4" class="muted-text">Failed to load auto-publish data.</td></tr>';
      }
      setSelectedStateBadge(null);
    } finally {
      state.loading = false;
    }
  }

  async function setAutoPublishState(guildId, channelId, enabled) {
    if (!guildId || !channelId) {
      AdminApp.setStatus('Select a server and channel first.', true);
      return;
    }

    try {
      AdminApp.setStatus((enabled ? 'Enabling' : 'Disabling') + ' auto-publish...');
      await AdminApp.fetchJson('/api/auto-publish', {
        method: 'PUT',
        body: JSON.stringify({
          guildId: guildId,
          channelId: channelId,
          enabled: enabled
        })
      });

      AdminApp.setStatus('Auto-publish ' + (enabled ? 'enabled.' : 'disabled.'));
      await loadAutoPublishData(true);
    } catch (error) {
      AdminApp.setStatus('Auto-publish update failed: ' + error.message, true);
    }
  }

  if (guildSearchInput) {
    guildSearchInput.addEventListener('input', refreshGuildSelect);
  }
  if (guildSelect) {
    guildSelect.addEventListener('change', function () {
      state.selectedGuildId = guildSelect.value;
      state.selectedChannelId = '';
      refreshChannelSelect();
    });
  }
  if (channelSearchInput) {
    channelSearchInput.addEventListener('input', refreshChannelSelect);
  }
  if (channelSelect) {
    channelSelect.addEventListener('change', function () {
      state.selectedChannelId = channelSelect.value;
      refreshSelectedState();
    });
  }

  if (toggleButton) {
    toggleButton.addEventListener('click', function () {
      var selectedChannel = getSelectedChannel();
      if (!selectedChannel) return;
      setAutoPublishState(state.selectedGuildId, selectedChannel.id, !selectedChannel.enabled);
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', function () {
      loadAutoPublishData(true);
    });
  }

  if (enabledBody) {
    enabledBody.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || target.tagName !== 'BUTTON') return;
      var guildId = target.getAttribute('data-guild-id');
      var channelId = target.getAttribute('data-channel-id');
      var enabled = target.getAttribute('data-enabled') === 'true';
      setAutoPublishState(guildId, channelId, enabled);
    });
  }

  AdminApp.onTabActivate('autopublish', function () {
    loadAutoPublishData(false);
  });
})();
