/* app.js -- shared utilities, tab switching, and user context */
(function () {
  'use strict';

  // -- Shared state --
  const state = {
    currentGuildId: '',
    guilds: [],
    user: null,
    csrfToken: ''
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
    var method = String((opts.method || 'GET')).toUpperCase();
    var headers = { 'Content-Type': 'application/json' };
    if (opts.headers && typeof opts.headers === 'object') {
      headers = { ...headers, ...opts.headers };
    }
    if (state.csrfToken && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
      headers['X-CSRF-Token'] = state.csrfToken;
    }

    var response = await fetch(url, {
      credentials: 'same-origin',
      headers: headers,
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

  function showConfirm(title, message, okLabel) {
    var overlay = document.getElementById('confirm-modal');
    var titleEl = document.getElementById('confirm-modal-title');
    var bodyEl = document.getElementById('confirm-modal-body');
    var okBtn = document.getElementById('confirm-modal-ok');
    var cancelBtn = document.getElementById('confirm-modal-cancel');

    if (!overlay || !titleEl || !bodyEl || !okBtn || !cancelBtn) {
      return Promise.resolve(window.confirm(String(message || title || 'Confirm?')));
    }

    return new Promise(function (resolve) {
      var previousActive = document.activeElement;
      var defaultOkLabel = 'Confirm';

      titleEl.textContent = String(title || 'Please Confirm');
      bodyEl.textContent = String(message || '');
      okBtn.textContent = String(okLabel || defaultOkLabel);

      overlay.classList.add('is-visible');
      overlay.setAttribute('aria-hidden', 'false');
      cancelBtn.focus();

      function cleanup(result) {
        overlay.classList.remove('is-visible');
        overlay.setAttribute('aria-hidden', 'true');
        okBtn.textContent = defaultOkLabel;
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', onKeyDown);
        if (previousActive && typeof previousActive.focus === 'function') {
          previousActive.focus();
        }
        resolve(result);
      }

      function onOk() {
        cleanup(true);
      }

      function onCancel() {
        cleanup(false);
      }

      function onOverlayClick(event) {
        if (event.target === overlay) {
          cleanup(false);
        }
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup(false);
        }
      }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keydown', onKeyDown);
    });
  }

  // -- Tab switching --
  var activeTab = '';
  var tabActivateCallbacks = {};

  function switchTab(tabId) {
    if (activeTab === tabId) return;
    activeTab = tabId;

    tabButtons.forEach(function (btn) {
      var isActive = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    tabPanels.forEach(function (panel) {
      var isActive = panel.id === 'tab-' + tabId;
      panel.classList.toggle('active', isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
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
      state.csrfToken = payload.csrfToken || '';
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
    showConfirm: showConfirm,
    onTabActivate: onTabActivate,
    onGuildChange: onGuildChange,
    switchTab: switchTab
  };
})();
