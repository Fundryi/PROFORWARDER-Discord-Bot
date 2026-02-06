/* logs.js -- Message logs tab */
(function () {
  'use strict';

  var logsBody = document.getElementById('logs-body');
  var configFilter = document.getElementById('logs-config-filter');
  var statusFilter = document.getElementById('logs-status-filter');
  var refreshBtn = document.getElementById('logs-refresh');
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
    cell.colSpan = 6;
    cell.className = 'muted-text';
    cell.textContent = message;
    row.appendChild(cell);
    logsBody.appendChild(row);
    loadMoreBtn.style.display = 'none';
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

      // Status
      var statusCell = document.createElement('td');
      statusCell.innerHTML = statusBadge(log.status);
      row.appendChild(statusCell);

      // Error
      var errorCell = document.createElement('td');
      errorCell.textContent = log.errorMessage || '';
      errorCell.style.fontSize = '12px';
      errorCell.style.color = log.errorMessage ? '#ff9fa8' : '';
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

      if (configId) params.push('configId=' + encodeURIComponent(configId));
      if (status) params.push('status=' + encodeURIComponent(status));
      params.push('limit=50');
      if (append && nextBeforeId) params.push('beforeId=' + nextBeforeId);

      var url = '/api/logs' + (params.length ? '?' + params.join('&') : '');
      var data = await AdminApp.fetchJson(url);

      renderLogs(data.logs || [], append);
      nextBeforeId = data.nextBeforeId;
      loadMoreBtn.style.display = data.hasMore ? 'inline-block' : 'none';
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

  // Events
  refreshBtn.addEventListener('click', function () {
    loadLogs(false);
  });

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
