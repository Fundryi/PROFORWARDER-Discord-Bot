/* logs.js -- Message logs tab */
(function () {
  'use strict';

  var logsBody = document.getElementById('logs-body');
  var configFilter = document.getElementById('logs-config-filter');
  var statusFilter = document.getElementById('logs-status-filter');
  var refreshBtn = document.getElementById('logs-refresh');
  var deleteFailedBtn = document.getElementById('logs-delete-failed');
  var messageSearchInput = document.getElementById('logs-message-search');
  var searchBtn = document.getElementById('logs-search');
  var clearSearchBtn = document.getElementById('logs-clear-search');
  var retrySourceInput = document.getElementById('logs-retry-source-id');
  var retrySourceBtn = document.getElementById('logs-retry-source');
  var loadMoreBtn = document.getElementById('logs-load-more');

  var nextBeforeId = null;
  var configOptionsLoaded = false;

  function formatTime(ts) {
    if (!ts) return '--';
    var d = new Date(ts);
    return d.toLocaleString();
  }

  function statusBadge(status) {
    var cls = 'status-badge';
    if (status === 'success') cls += ' success';
    else if (status === 'failed') cls += ' failed';
    else if (status === 'retry') cls += ' retry';
    return '<span class="' + cls + '">' + (status || 'unknown') + '</span>';
  }

  function escapeText(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function setLogsMessage(message) {
    logsBody.innerHTML = '';
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'muted-text';
    cell.textContent = message;
    row.appendChild(cell);
    logsBody.appendChild(row);
    setLoadMoreVisible(false);
  }

  function buildTargetLabel(log) {
    if (log && log.targetLabel) return String(log.targetLabel);
    if (log && log.targetType === 'telegram') {
      return 'Telegram ' + String(log.forwardedChannelId || '-');
    }

    var forwardedServerId = String(log && log.forwardedServerId ? log.forwardedServerId : '').trim();
    var forwardedChannelId = String(log && log.forwardedChannelId ? log.forwardedChannelId : '').trim();
    if (forwardedServerId && forwardedChannelId) {
      return 'Discord ' + forwardedServerId + ':' + forwardedChannelId;
    }
    if (forwardedChannelId) {
      return 'Discord ' + forwardedChannelId;
    }
    return 'Unknown';
  }

  function setLoadMoreVisible(visible) {
    if (!loadMoreBtn) return;
    loadMoreBtn.classList.toggle('is-hidden', !visible);
  }

  function getMessageSearchValue() {
    if (!messageSearchInput) return '';
    return String(messageSearchInput.value || '').trim();
  }

  function renderLogs(logs, append) {
    if (!append) {
      logsBody.innerHTML = '';
    }

    if (!logs.length && !append) {
      setLogsMessage('No logs found.');
      return;
    }

    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      var row = document.createElement('tr');

      // Time
      var timeCell = document.createElement('td');
      timeCell.textContent = formatTime(log.forwardedAt);
      row.appendChild(timeCell);

      // Config ID
      var configCell = document.createElement('td');
      configCell.className = 'mono';
      configCell.textContent = String(log.configId);
      row.appendChild(configCell);

      // Original message
      var origCell = document.createElement('td');
      origCell.className = 'mono';
      origCell.textContent = log.originalMessageId || '-';
      row.appendChild(origCell);

      // Forwarded message
      var fwdCell = document.createElement('td');
      fwdCell.className = 'mono';
      fwdCell.textContent = log.forwardedMessageId || '-';
      row.appendChild(fwdCell);

      // Target
      var targetCell = document.createElement('td');
      targetCell.className = 'mono log-target';
      targetCell.textContent = buildTargetLabel(log);
      row.appendChild(targetCell);

      // Status
      var statusCell = document.createElement('td');
      statusCell.innerHTML = statusBadge(log.status);
      row.appendChild(statusCell);

      // Error
      var errorCell = document.createElement('td');
      errorCell.className = 'logs-error';
      errorCell.textContent = log.errorMessage || '';
      if (log.errorMessage) errorCell.classList.add('has-error');
      row.appendChild(errorCell);

      logsBody.appendChild(row);
    }
  }

  async function loadLogs(append) {
    if (!append) {
      setLogsMessage('Loading...');
      nextBeforeId = null;
    }

    try {
      var params = [];
      var configId = configFilter.value;
      var status = statusFilter.value;
      var messageId = getMessageSearchValue();

      if (configId) params.push('configId=' + encodeURIComponent(configId));
      if (status) params.push('status=' + encodeURIComponent(status));
      if (messageId) params.push('messageId=' + encodeURIComponent(messageId));
      params.push('limit=50');
      if (append && nextBeforeId) params.push('beforeId=' + nextBeforeId);

      var url = '/api/logs' + (params.length ? '?' + params.join('&') : '');
      var data = await AdminApp.fetchJson(url);

      renderLogs(data.logs || [], append);
      nextBeforeId = data.nextBeforeId;
      setLoadMoreVisible(Boolean(data.hasMore));
    } catch (error) {
      if (!append) {
        setLogsMessage('Failed to load logs: ' + error.message);
      } else {
        AdminApp.setStatus('Failed to load more logs: ' + error.message, true);
      }
    }
  }

  async function loadConfigOptions() {
    if (configOptionsLoaded) return;
    try {
      // Populate config filter from existing configs across all guilds
      var guilds = AdminApp.state.guilds || [];
      var configIds = new Set();

      for (var i = 0; i < guilds.length; i++) {
        try {
          var data = await AdminApp.fetchJson('/api/configs?guildId=' + encodeURIComponent(guilds[i].id));
          var configs = data.configs || [];
          for (var j = 0; j < configs.length; j++) {
            if (!configIds.has(configs[j].id)) {
              configIds.add(configs[j].id);
              var opt = document.createElement('option');
              opt.value = configs[j].id;
              opt.textContent = configs[j].id + ' - ' + (configs[j].name || 'Unnamed');
              configFilter.appendChild(opt);
            }
          }
        } catch (_e) {
          // skip guild if loading configs fails
        }
      }
      configOptionsLoaded = true;
    } catch (_e) {
      // ignore
    }
  }

  function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
  }

  function setDeleteFailedBusy(isBusy) {
    if (!deleteFailedBtn) return;
    deleteFailedBtn.disabled = isBusy;
    deleteFailedBtn.textContent = isBusy ? 'Deleting...' : 'Delete Failed Logs';
  }

  function setRetryBusy(isBusy) {
    if (!retrySourceBtn) return;
    retrySourceBtn.disabled = isBusy;
    retrySourceBtn.textContent = isBusy ? 'Retrying...' : 'Retry Source Message';
  }

  async function deleteFailedLogs() {
    var configId = configFilter.value;
    var scopeText = configId
      ? 'for config ' + configId
      : 'for all configs';
    var warning = 'Delete FAILED log entries ' + scopeText + '? This cannot be undone.';

    if (statusFilter.value && statusFilter.value !== 'failed') {
      warning += '\n\nNote: current status filter "' + statusFilter.value + '" does not change this action.';
    }

    var confirmed = await AdminApp.showConfirm(
      'Delete Failed Logs',
      warning,
      'Delete'
    );
    if (!confirmed) return;

    try {
      setDeleteFailedBusy(true);
      AdminApp.setStatus('Deleting failed logs...');
      var params = ['status=failed'];
      if (configId) params.push('configId=' + encodeURIComponent(configId));

      var result = await AdminApp.fetchJson('/api/logs?' + params.join('&'), {
        method: 'DELETE'
      });

      var deleted = Number(result.deleted || 0);
      if (deleted > 0) {
        AdminApp.setStatus('Deleted ' + deleted + ' failed log ' + pluralize(deleted, 'entry', 'entries') + '.');
      } else {
        AdminApp.setStatus('No failed log entries matched the selected scope.');
      }
      await loadLogs(false);
    } catch (error) {
      AdminApp.setStatus('Failed to delete logs: ' + error.message, true);
    } finally {
      setDeleteFailedBusy(false);
    }
  }

  async function retrySourceMessage() {
    var sourceMessageId = String(retrySourceInput ? retrySourceInput.value : '').trim();
    if (!/^\d+$/.test(sourceMessageId)) {
      AdminApp.setStatus('Enter a valid numeric source message ID to retry.', true);
      return;
    }

    try {
      setRetryBusy(true);
      AdminApp.setStatus('Retrying source message ' + sourceMessageId + '...');
      var result = await AdminApp.fetchJson('/api/forwards/retry', {
        method: 'POST',
        body: JSON.stringify({ sourceMessageId: sourceMessageId })
      });

      var successCount = Number(result.successCount || 0);
      var failedCount = Number(result.failedCount || 0);
      var processed = Number(result.processed || 0);

      AdminApp.setStatus(
        'Retry complete for source ' + sourceMessageId + ': ' +
        successCount + ' success, ' + failedCount + ' failed (' + processed + ' config' + pluralize(processed, '', 's') + ').'
      );
      await loadLogs(false);
    } catch (error) {
      AdminApp.setStatus('Retry failed: ' + error.message, true);
    } finally {
      setRetryBusy(false);
    }
  }

  // Events
  refreshBtn.addEventListener('click', function () {
    loadLogs(false);
  });

  if (deleteFailedBtn) {
    deleteFailedBtn.textContent = 'Delete Failed Logs';
    deleteFailedBtn.addEventListener('click', function () {
      deleteFailedLogs();
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', function () {
      loadLogs(false);
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', function () {
      if (messageSearchInput) messageSearchInput.value = '';
      loadLogs(false);
    });
  }

  if (messageSearchInput) {
    messageSearchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadLogs(false);
      }
    });
  }

  if (retrySourceBtn) {
    retrySourceBtn.addEventListener('click', function () {
      retrySourceMessage();
    });
  }

  if (retrySourceInput) {
    retrySourceInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        retrySourceMessage();
      }
    });
  }

  loadMoreBtn.addEventListener('click', function () {
    loadLogs(true);
  });

  configFilter.addEventListener('change', function () {
    loadLogs(false);
  });

  statusFilter.addEventListener('change', function () {
    loadLogs(false);
  });

  AdminApp.onTabActivate('logs', function () {
    loadConfigOptions();
    loadLogs(false);
  });
})();
