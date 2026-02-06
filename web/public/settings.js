/* settings.js -- Bot settings tab */
(function () {
  'use strict';

  var runtimeContainer = document.getElementById('runtime-config');
  var botSettingsContainer = document.getElementById('bot-settings');
  var addSettingForm = document.getElementById('add-setting-form');

  function escapeText(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderRuntimeConfig(runtime) {
    var html = '';
    var keys = Object.keys(runtime);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = runtime[key];
      var valStr = String(val);
      var valClass = '';
      if (val === true) valClass = ' true';
      else if (val === false) valClass = ' false';

      html += '<div class="runtime-item">' +
        '<span class="key">' + escapeText(key) + '</span>' +
        '<span class="val' + valClass + '">' + escapeText(valStr) + '</span>' +
        '</div>';
    }
    runtimeContainer.innerHTML = html;
  }

  function renderBotSettings(settings) {
    botSettingsContainer.innerHTML = '';

    if (!settings.length) {
      botSettingsContainer.innerHTML = '<p class="muted-text">No bot settings stored yet.</p>';
      return;
    }

    for (var i = 0; i < settings.length; i++) {
      (function (setting) {
        var row = document.createElement('div');
        row.className = 'setting-row';

        var keySpan = document.createElement('span');
        keySpan.className = 'setting-key';
        keySpan.textContent = setting.key;
        row.appendChild(keySpan);

        var valueDiv = document.createElement('div');
        valueDiv.className = 'setting-value';
        var input = document.createElement('input');
        input.value = setting.value;
        valueDiv.appendChild(input);
        row.appendChild(valueDiv);

        var actionsDiv = document.createElement('div');
        actionsDiv.className = 'setting-actions';

        var saveBtn = document.createElement('button');
        saveBtn.className = 'button sm';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async function () {
          try {
            AdminApp.setStatus('Saving ' + setting.key + '...');
            await AdminApp.fetchJson('/api/settings/' + encodeURIComponent(setting.key), {
              method: 'PUT',
              body: JSON.stringify({ value: input.value })
            });
            AdminApp.setStatus('Setting ' + setting.key + ' saved.');
          } catch (error) {
            AdminApp.setStatus('Save failed: ' + error.message, true);
          }
        });
        actionsDiv.appendChild(saveBtn);

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'button secondary sm danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async function () {
          if (!confirm('Delete setting "' + setting.key + '"?')) return;
          try {
            AdminApp.setStatus('Deleting ' + setting.key + '...');
            await AdminApp.fetchJson('/api/settings/' + encodeURIComponent(setting.key), {
              method: 'DELETE'
            });
            AdminApp.setStatus('Setting ' + setting.key + ' deleted.');
            await loadSettings();
          } catch (error) {
            AdminApp.setStatus('Delete failed: ' + error.message, true);
          }
        });
        actionsDiv.appendChild(deleteBtn);

        row.appendChild(actionsDiv);
        botSettingsContainer.appendChild(row);
      })(settings[i]);
    }
  }

  async function loadSettings() {
    try {
      var data = await AdminApp.fetchJson('/api/settings');
      renderRuntimeConfig(data.runtime || {});
      renderBotSettings(data.settings || []);
    } catch (error) {
      runtimeContainer.innerHTML = '<p class="muted-text">Failed to load settings.</p>';
      botSettingsContainer.innerHTML = '';
      AdminApp.setStatus('Failed to load settings: ' + error.message, true);
    }
  }

  // Add setting form
  if (addSettingForm) {
    addSettingForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var keyInput = document.getElementById('new-setting-key');
      var valueInput = document.getElementById('new-setting-value');
      var key = keyInput.value.trim();
      var value = valueInput.value;

      if (!key) {
        AdminApp.setStatus('Key is required.', true);
        return;
      }

      try {
        AdminApp.setStatus('Adding setting...');
        await AdminApp.fetchJson('/api/settings/' + encodeURIComponent(key), {
          method: 'PUT',
          body: JSON.stringify({ value: value })
        });
        addSettingForm.reset();
        AdminApp.setStatus('Setting added.');
        await loadSettings();
      } catch (error) {
        AdminApp.setStatus('Add failed: ' + error.message, true);
      }
    });
  }

  AdminApp.onTabActivate('settings', function () {
    loadSettings();
  });
})();
