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
  var messageIdInput = document.getElementById('debug-message-id');
  var messageSearchButton = document.getElementById('debug-message-search');
  var messageMeta = document.getElementById('debug-message-meta');
  var messageAllBody = document.getElementById('debug-message-all-body');
  var messageEditBody = document.getElementById('debug-message-edit-body');

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

  function setMessageMeta(text, isError) {
    if (!messageMeta) return;
    messageMeta.className = isError ? 'muted-text error-text' : 'muted-text';
    messageMeta.textContent = text;
  }

  function renderMessageRows(tbody, rows, emptyMessage) {
    if (!tbody) return;
    if (!Array.isArray(rows) || !rows.length) {
      setTableMessage(tbody, 7, emptyMessage);
      return;
    }

    tbody.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var item = rows[i] || {};
      var row = document.createElement('tr');
      appendCell(row, String(item.id || '-'), 'mono');
      appendCell(row, formatTime(item.forwardedAt));
      appendCell(row, item.status || 'unknown');
      appendCell(row, String(item.configId || '-'));
      appendCell(row, String(item.originalMessageId || '-'), 'mono');
      appendCell(row, String(item.forwardedMessageId || '-'), 'mono');
      appendCell(row, item.errorMessage || '-', item.errorMessage ? 'error-text' : '');
      tbody.appendChild(row);
    }
  }

  function summarizeTruncation(prefix, total, shown, truncated) {
    if (!truncated) {
      return prefix + ': ' + shown + ' row' + (shown === 1 ? '' : 's') + '.';
    }
    return prefix + ': showing ' + shown + ' of ' + total + ' row' + (total === 1 ? '' : 's') + '.';
  }

  async function searchMessageDrilldown() {
    var messageId = String(messageIdInput ? messageIdInput.value : '').trim();
    if (!/^\d+$/.test(messageId)) {
      setMessageMeta('Enter a numeric Discord message ID.', true);
      setTableMessage(messageAllBody, 7, 'Enter a numeric Discord message ID.');
      setTableMessage(messageEditBody, 7, 'Enter a numeric Discord message ID.');
      return;
    }

    setMessageMeta('Searching message logs for ' + messageId + '...');
    setTableMessage(messageAllBody, 7, 'Loading...');
    setTableMessage(messageEditBody, 7, 'Loading...');

    try {
      var result = await AdminApp.fetchJson('/api/debug/message-search?messageId=' + encodeURIComponent(messageId));
      var allMatches = Array.isArray(result.allMatches) ? result.allMatches : [];
      var editMatches = Array.isArray(result.editHandlerMatches) ? result.editHandlerMatches : [];
      var allTotal = Number(result.allMatchesTotal || allMatches.length || 0);
      var editTotal = Number(result.editHandlerMatchesTotal || editMatches.length || 0);

      renderMessageRows(messageAllBody, allMatches, 'No matching log rows found.');
      renderMessageRows(messageEditBody, editMatches, 'No edit-handler success rows found.');

      var summary = summarizeTruncation(
        'All matches',
        allTotal,
        allMatches.length,
        Boolean(result.allMatchesTruncated)
      );
      summary += ' ';
      summary += summarizeTruncation(
        'Edit-handler matches',
        editTotal,
        editMatches.length,
        Boolean(result.editHandlerMatchesTruncated)
      );
      setMessageMeta(summary);

      AdminApp.setStatus('Debug message search complete for ' + messageId + '.');
    } catch (error) {
      setMessageMeta('Message drilldown failed: ' + error.message, true);
      setTableMessage(messageAllBody, 7, 'Failed to load message drilldown.');
      setTableMessage(messageEditBody, 7, 'Failed to load message drilldown.');
      AdminApp.setStatus('Failed to load debug message search: ' + error.message, true);
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

  if (messageSearchButton) {
    messageSearchButton.addEventListener('click', function () {
      searchMessageDrilldown();
    });
  }

  if (messageIdInput) {
    messageIdInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchMessageDrilldown();
      }
    });
  }

  setTableMessage(messageAllBody, 7, 'Enter a message ID and click Search.');
  setTableMessage(messageEditBody, 7, 'Enter a message ID and click Search.');
  setMessageMeta('Enter a message ID and click Search.');

  AdminApp.onTabActivate('debug', function () {
    loadDebugDiagnostics();
  });
})();
