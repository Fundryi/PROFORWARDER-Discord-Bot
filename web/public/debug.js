/* debug.js -- Read-only database diagnostics tab (WEB_ADMIN_DEBUG only) */
(function () {
  'use strict';

  var summaryContainer = document.getElementById('debug-db-summary');
  if (!summaryContainer) return;

  var refreshButton = document.getElementById('debug-refresh');
  var statusBody = document.getElementById('debug-log-status-body');
  var discoveredViaBody = document.getElementById('debug-discovered-via-body');
  var recentLogsBody = document.getElementById('debug-recent-logs-body');
  var failedLogsBody = document.getElementById('debug-failed-logs-body');
  var settingsBody = document.getElementById('debug-settings-body');

  function formatTime(timestamp) {
    var value = Number(timestamp || 0);
    if (!value) return '--';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '--';
    return date.toLocaleString();
  }

  function setTableMessage(tbody, colSpan, message) {
    if (!tbody) return;
    tbody.innerHTML = '';
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.colSpan = colSpan;
    cell.className = 'muted-text';
    cell.textContent = message;
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  function appendCell(row, text, className) {
    var cell = document.createElement('td');
    cell.textContent = String(text == null ? '' : text);
    if (className) cell.className = className;
    row.appendChild(cell);
  }

  function createSummaryCard(value, label, extraClass) {
    var classSuffix = extraClass ? ' ' + extraClass : '';
    return '<div class="stat-card">' +
      '<div class="stat-value' + classSuffix + '">' + value + '</div>' +
      '<div class="stat-label">' + label + '</div>' +
      '</div>';
  }

  function renderSummary(data) {
    var tableCounts = data && data.tableCounts ? data.tableCounts : {};
    var statusCounts = Array.isArray(data && data.statusCounts) ? data.statusCounts : [];
    var configSummary = data && data.configSummary ? data.configSummary : {};

    var failedCount = 0;
    for (var i = 0; i < statusCounts.length; i++) {
      if (String(statusCounts[i].status || '').toLowerCase() === 'failed') {
        failedCount = Number(statusCounts[i].count || 0);
        break;
      }
    }

    var html = '';
    html += createSummaryCard(String(tableCounts.message_logs || 0), 'Message Logs');
    html += createSummaryCard(String(failedCount), 'Failed Logs', failedCount > 0 ? 'offline' : 'online');
    html += createSummaryCard(String(tableCounts.telegram_chats || 0), 'Tracked Telegram Chats');
    html += createSummaryCard(String(tableCounts.bot_settings || 0), 'Bot Settings');
    html += createSummaryCard(
      String(configSummary.active || 0) + '/' + String(configSummary.total || 0),
      'Active Configs'
    );
    html += createSummaryCard(String(configSummary.readerSources || 0), 'Reader Source Configs');
    summaryContainer.innerHTML = html;
  }

  function renderStatusCounts(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      setTableMessage(statusBody, 2, 'No message log rows found.');
      return;
    }

    statusBody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var row = document.createElement('tr');
      appendCell(row, rows[i].status || 'unknown', 'mono');
      appendCell(row, String(rows[i].count || 0));
      statusBody.appendChild(row);
    }
  }

  function renderDiscoveredViaCounts(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      setTableMessage(discoveredViaBody, 2, 'No tracked Telegram chats found.');
      return;
    }

    discoveredViaBody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var row = document.createElement('tr');
      appendCell(row, rows[i].discoveredVia || 'unknown', 'mono');
      appendCell(row, String(rows[i].count || 0));
      discoveredViaBody.appendChild(row);
    }
  }

  function renderRecentLogs(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      setTableMessage(recentLogsBody, 6, 'No recent message logs found.');
      return;
    }

    recentLogsBody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var item = rows[i] || {};
      var row = document.createElement('tr');
      appendCell(row, String(item.id || '-'), 'mono');
      appendCell(row, formatTime(item.forwardedAt));
      appendCell(row, item.status || 'unknown');
      appendCell(row, String(item.configId || '-'));
      appendCell(row, String(item.originalMessageId || '-'), 'mono');
      appendCell(row, String(item.forwardedMessageId || '-'), 'mono');
      recentLogsBody.appendChild(row);
    }
  }

  function renderFailedLogs(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      setTableMessage(failedLogsBody, 4, 'No recent failed logs found.');
      return;
    }

    failedLogsBody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var item = rows[i] || {};
      var row = document.createElement('tr');
      appendCell(row, String(item.id || '-'), 'mono');
      appendCell(row, formatTime(item.forwardedAt));
      appendCell(row, String(item.configId || '-'));
      appendCell(row, item.errorMessage || '-', 'error-text');
      failedLogsBody.appendChild(row);
    }
  }

  function renderSettings(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      setTableMessage(settingsBody, 2, 'No bot settings found.');
      return;
    }

    settingsBody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var item = rows[i] || {};
      var row = document.createElement('tr');
      appendCell(row, item.key || '-', 'mono');
      appendCell(row, formatTime(item.updatedAt));
      settingsBody.appendChild(row);
    }
  }

  async function loadDebugDiagnostics() {
    setTableMessage(statusBody, 2, 'Loading...');
    setTableMessage(discoveredViaBody, 2, 'Loading...');
    setTableMessage(recentLogsBody, 6, 'Loading...');
    setTableMessage(failedLogsBody, 4, 'Loading...');
    setTableMessage(settingsBody, 2, 'Loading...');

    try {
      var data = await AdminApp.fetchJson('/api/debug/database');
      renderSummary(data || {});
      renderStatusCounts(data.statusCounts || []);
      renderDiscoveredViaCounts(data.discoveredViaCounts || []);
      renderRecentLogs(data.recentLogs || []);
      renderFailedLogs(data.failedLogs || []);
      renderSettings(data.recentSettings || []);
      AdminApp.setStatus('Debug diagnostics refreshed.');
    } catch (error) {
      summaryContainer.innerHTML = createSummaryCard('Error', error.message || 'Failed', 'offline');
      setTableMessage(statusBody, 2, 'Failed to load diagnostics.');
      setTableMessage(discoveredViaBody, 2, 'Failed to load diagnostics.');
      setTableMessage(recentLogsBody, 6, 'Failed to load diagnostics.');
      setTableMessage(failedLogsBody, 4, 'Failed to load diagnostics.');
      setTableMessage(settingsBody, 2, 'Failed to load diagnostics.');
      AdminApp.setStatus('Failed to load debug diagnostics: ' + error.message, true);
    }
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', function () {
      loadDebugDiagnostics();
    });
  }

  AdminApp.onTabActivate('debug', function () {
    loadDebugDiagnostics();
  });
})();
