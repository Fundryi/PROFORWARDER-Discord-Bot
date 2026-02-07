/* dashboard.js -- Dashboard overview tab */
(function () {
  'use strict';

  var statsContainer = document.getElementById('dashboard-stats');
  var diagnosticsContainer = document.getElementById('reader-diagnostics-panel');
  var diagnosticsRefreshBtn = document.getElementById('reader-diagnostics-refresh');
  var refreshTimer = null;

  function formatUptime(ms) {
    if (!ms || ms < 0) return '--';
    var seconds = Math.floor(ms / 1000);
    var days = Math.floor(seconds / 86400);
    seconds %= 86400;
    var hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    var minutes = Math.floor(seconds / 60);
    seconds %= 60;

    var parts = [];
    if (days > 0) parts.push(days + 'd');
    if (hours > 0) parts.push(hours + 'h');
    if (minutes > 0) parts.push(minutes + 'm');
    parts.push(seconds + 's');
    return parts.join(' ');
  }

  function statCard(value, label, extraClass) {
    var cls = extraClass ? ' ' + extraClass : '';
    return '<div class="stat-card">' +
      '<div class="stat-value' + cls + '">' + value + '</div>' +
      '<div class="stat-label">' + label + '</div>' +
      '</div>';
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function setDiagnosticsError(message) {
    if (!diagnosticsContainer) return;
    diagnosticsContainer.innerHTML = '';

    var error = document.createElement('p');
    error.className = 'muted-text error-text';
    error.textContent = 'Reader diagnostics unavailable: ' + message;
    diagnosticsContainer.appendChild(error);
  }

  function renderReaderDiagnostics(payload) {
    if (!diagnosticsContainer) return;

    var reader = payload && payload.readerBot ? payload.readerBot : {};
    var diagnostics = payload && payload.diagnostics ? payload.diagnostics : {};
    var failures = Array.isArray(diagnostics.failures) ? diagnostics.failures : [];
    var checkedCount = Number(diagnostics.checkedConfigCount || 0);
    var failureCount = Number(diagnostics.failureCount || failures.length || 0);

    clearNode(diagnosticsContainer);

    var summary = document.createElement('div');
    summary.className = 'reader-diagnostics-summary';

    var statusBadge = document.createElement('span');
    if (reader.enabled && reader.online) {
      statusBadge.className = 'status-badge success';
      statusBadge.textContent = 'Reader Online';
    } else if (reader.enabled && !reader.online) {
      statusBadge.className = 'status-badge failed';
      statusBadge.textContent = 'Reader Offline';
    } else {
      statusBadge.className = 'status-badge retry';
      statusBadge.textContent = 'Reader Disabled';
    }
    summary.appendChild(statusBadge);

    var facts = document.createElement('div');
    facts.className = 'reader-diagnostics-facts muted-text';
    facts.textContent = 'Guilds: ' + String(reader.guildCount || 0) +
      ' | Checked configs: ' + checkedCount +
      ' | Failures: ' + failureCount;
    summary.appendChild(facts);

    diagnosticsContainer.appendChild(summary);

    var inviteArea = document.createElement('p');
    inviteArea.className = 'muted-text';
    if (reader.inviteUrl) {
      inviteArea.appendChild(document.createTextNode('Need reader access? '));
      var inviteLink = document.createElement('a');
      inviteLink.className = 'reader-invite-link';
      inviteLink.href = reader.inviteUrl;
      inviteLink.target = '_blank';
      inviteLink.rel = 'noopener noreferrer';
      inviteLink.textContent = 'Invite Reader Bot';
      inviteArea.appendChild(inviteLink);
      inviteArea.appendChild(document.createTextNode(' (View Channel + Read Message History).'));
    } else if (!reader.enabled) {
      inviteArea.textContent = 'Reader bot is disabled in config. Enable it to monitor external source servers.';
    } else {
      inviteArea.textContent = 'Reader invite link will appear once the reader bot is online.';
    }
    diagnosticsContainer.appendChild(inviteArea);

    if (!failures.length) {
      var ok = document.createElement('p');
      ok.className = 'muted-text';
      ok.textContent = checkedCount > 0
        ? 'No source access failures detected for active forward configs.'
        : 'No active forward configs available for diagnostics.';
      diagnosticsContainer.appendChild(ok);
      return;
    }

    var list = document.createElement('ul');
    list.className = 'reader-diagnostics-list';
    var visibleCount = Math.min(failures.length, 8);

    for (var i = 0; i < visibleCount; i++) {
      var failure = failures[i];
      var item = document.createElement('li');
      item.className = 'reader-diagnostics-item';

      var title = document.createElement('div');
      title.className = 'reader-diagnostics-title';
      var cfgId = failure.configId != null ? String(failure.configId) : '?';
      var cfgName = failure.configName || ('Config ' + cfgId);
      var sourceBot = failure.sourceBot === 'reader' ? 'reader' : 'main';
      title.textContent = '#' + cfgId + ' ' + cfgName + ' (' + sourceBot + ' source)';
      item.appendChild(title);

      var scope = document.createElement('div');
      scope.className = 'muted-text';
      scope.textContent = 'Source: ' + (failure.sourceServerId || '-') + ' / ' + (failure.sourceChannelId || '-');
      item.appendChild(scope);

      var issue = document.createElement('div');
      issue.className = 'reader-diagnostics-error';
      issue.textContent = failure.error || 'Unknown source access issue.';
      item.appendChild(issue);

      if (failure.hint) {
        var hint = document.createElement('div');
        hint.className = 'muted-text';
        hint.textContent = 'Action: ' + failure.hint;
        item.appendChild(hint);
      }

      list.appendChild(item);
    }

    diagnosticsContainer.appendChild(list);

    if (failures.length > visibleCount) {
      var more = document.createElement('p');
      more.className = 'muted-text';
      more.textContent = 'Showing first ' + visibleCount + ' failures of ' + failures.length + '.';
      diagnosticsContainer.appendChild(more);
    }
  }

  async function loadDashboard() {
    var responses = await Promise.allSettled([
      AdminApp.fetchJson('/api/dashboard'),
      AdminApp.fetchJson('/api/logs/stats'),
      AdminApp.fetchJson('/api/reader-status')
    ]);

    try {
      if (responses[0].status !== 'fulfilled' || responses[1].status !== 'fulfilled') {
        var dashboardError = responses[0].status === 'rejected'
          ? responses[0].reason
          : responses[1].reason;
        throw dashboardError;
      }

      var data = responses[0].value;
      var logStats = responses[1].value;
      var bot = data.bot;
      var configs = data.configs;

      var html = '';
      html += statCard(bot.ready ? 'Online' : 'Offline', 'Bot Status', bot.ready ? 'online' : 'offline');
      html += statCard(formatUptime(bot.uptime), 'Uptime');
      html += statCard(String(bot.guildCount || 0), 'Guilds');
      html += statCard(String(configs.active || 0), 'Active Configs');
      html += statCard(String(configs.disabled || 0), 'Disabled Configs');
      html += statCard(String(logStats.today || 0), 'Messages Today');
      html += statCard(String(logStats.total || 0), 'Total Messages');
      html += statCard(String(logStats.failed || 0), 'Failed', logStats.failed > 0 ? 'offline' : '');

      statsContainer.innerHTML = html;
    } catch (error) {
      statsContainer.innerHTML = '<div class="stat-card"><div class="stat-value offline">Error</div>' +
        '<div class="stat-label">' + error.message + '</div></div>';
    }

    if (responses[2].status === 'fulfilled') {
      renderReaderDiagnostics(responses[2].value);
    } else {
      var reason = responses[2].reason && responses[2].reason.message
        ? responses[2].reason.message
        : 'Request failed';
      setDiagnosticsError(reason);
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(loadDashboard, 30000);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  AdminApp.onTabActivate('dashboard', function () {
    loadDashboard();
    startAutoRefresh();
  });

  if (diagnosticsRefreshBtn) {
    diagnosticsRefreshBtn.addEventListener('click', function () {
      loadDashboard();
    });
  }

  // Stop refreshing when switching away from dashboard
  var originalSwitchTab = AdminApp.switchTab;
  AdminApp.switchTab = function (tabId) {
    if (tabId !== 'dashboard') {
      stopAutoRefresh();
    }
    originalSwitchTab(tabId);
  };
})();
