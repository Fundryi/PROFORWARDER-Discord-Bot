/* dashboard.js -- Dashboard overview tab */
(function () {
  'use strict';

  var statsContainer = document.getElementById('dashboard-stats');
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

  async function loadDashboard() {
    try {
      var data = await AdminApp.fetchJson('/api/dashboard');
      var logStats = await AdminApp.fetchJson('/api/logs/stats');

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

  // Stop refreshing when switching away from dashboard
  var originalSwitchTab = AdminApp.switchTab;
  AdminApp.switchTab = function (tabId) {
    if (tabId !== 'dashboard') {
      stopAutoRefresh();
    }
    originalSwitchTab(tabId);
  };
})();
