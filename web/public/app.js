/* app.js -- shared utilities, tab switching, and user context */
(function () {
  'use strict';

  // -- Shared state --
  const state = {
    currentGuildId: '',
    guilds: [],
    user: null
  };

  // -- DOM refs --
  const statusMessage = document.getElementById('status-message');
  const guildSelect = document.getElementById('guild-select');
  const tabButtons = document.querySelectorAll('.tab-nav button[data-tab]');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // -- Helpers --
  function setStatus(message, isError) {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.className = isError ? 'error-text' : 'muted-text';
  }

  async function fetchJson(url, options) {
    var opts = options || {};
    var response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    if (!response.ok) {
      var message = 'Request failed';
      try {
        var payload = await response.json();
        message = payload.error || message;
      } catch (_e) {
        var text = await response.text();
        if (text) message = text;
      }
      throw new Error(message);
    }
    return response.json();
  }

  // -- Tab switching --
  var activeTab = '';
  var tabActivateCallbacks = {};

  function switchTab(tabId) {
    if (activeTab === tabId) return;
    activeTab = tabId;

    tabButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    tabPanels.forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'tab-' + tabId);
    });

    // fire activation callback
    if (tabActivateCallbacks[tabId]) {
      tabActivateCallbacks[tabId]();
    }
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchTab(btn.getAttribute('data-tab'));
    });
  });

  function onTabActivate(tabId, callback) {
    tabActivateCallbacks[tabId] = callback;
  }

  // -- Guild selector --
  function populateGuilds(guilds) {
    if (!guildSelect) return;
    guildSelect.innerHTML = '';

    if (!guilds.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No authorized guilds found';
      guildSelect.appendChild(opt);
      return;
    }

    for (var i = 0; i < guilds.length; i++) {
      var option = document.createElement('option');
      option.value = guilds[i].id;
      option.textContent = guilds[i].name + ' (' + guilds[i].id + ')';
      guildSelect.appendChild(option);
    }

    state.currentGuildId = guildSelect.value;
  }

  if (guildSelect) {
    guildSelect.addEventListener('change', function () {
      state.currentGuildId = guildSelect.value;
      // notify listeners
      if (guildChangeCallbacks.length) {
        guildChangeCallbacks.forEach(function (cb) { cb(state.currentGuildId); });
      }
    });
  }

  var guildChangeCallbacks = [];
  function onGuildChange(callback) {
    guildChangeCallbacks.push(callback);
  }

  // -- Load user context --
  async function loadMe() {
    try {
      var payload = await fetchJson('/api/me');
      state.user = payload.user;
      state.guilds = payload.guilds || [];
      populateGuilds(state.guilds);
    } catch (error) {
      setStatus('Failed to load user context.', true);
    }
  }

  // -- Check for invite status from URL query params --
  function handleInviteStatus() {
    var urlParams = new URLSearchParams(window.location.search);
    var inviteResult = urlParams.get('invite');
    if (inviteResult === 'success') {
      var guildId = urlParams.get('guild');
      var msg = 'Bot successfully invited to server' + (guildId ? ' (' + guildId + ')' : '') + '.';
      setStatus(msg, false);
      history.replaceState(null, '', '/admin');
    } else if (inviteResult === 'error') {
      setStatus('Bot invite failed. Check that the redirect URI is registered in the Discord Developer Portal.', true);
      history.replaceState(null, '', '/admin');
    }
  }

  // -- Init --
  handleInviteStatus();
  loadMe().then(function () {
    // Activate the default tab (dashboard) after user context is loaded
    switchTab('dashboard');
  });

  // -- Public API --
  window.AdminApp = {
    state: state,
    fetchJson: fetchJson,
    setStatus: setStatus,
    onTabActivate: onTabActivate,
    onGuildChange: onGuildChange,
    switchTab: switchTab
  };
})();
