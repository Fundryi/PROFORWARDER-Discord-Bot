/* settings.js -- Bot settings tab */
(function () {
  'use strict';

  var runtimeContainer = document.getElementById('runtime-config');
  var botSettingsContainer = document.getElementById('bot-settings');
  var addSettingForm = document.getElementById('add-setting-form');
  var newSettingKeyInput = document.getElementById('new-setting-key');
  var newSettingHelp = document.getElementById('new-setting-help');

  var DEFAULT_DEFINITIONS = {
    uploaded_emoji_names: {
      label: 'Uploaded Application Emoji Names',
      description: 'JSON array of emoji names tracked by the application emoji manager.',
      format: 'JSON array string',
      example: '["party_parrot","thonk"]',
      managedBy: 'Automatic'
    }
  };

  var state = {
    definitions: DEFAULT_DEFINITIONS,
    emojiPreviewByName: {},
    emojiPreviewMeta: null
  };

  function mergeDefinitions(serverDefinitions) {
    var merged = {};
    var defaultKeys = Object.keys(DEFAULT_DEFINITIONS);
    for (var i = 0; i < defaultKeys.length; i++) {
      merged[defaultKeys[i]] = DEFAULT_DEFINITIONS[defaultKeys[i]];
    }

    if (!serverDefinitions || typeof serverDefinitions !== 'object') {
      return merged;
    }

    var keys = Object.keys(serverDefinitions);
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      merged[key] = serverDefinitions[key];
    }
    return merged;
  }

  function inferValueType(rawValue) {
    var value = String(rawValue == null ? '' : rawValue).trim();
    if (!value) return 'empty';
    if (value === 'true' || value === 'false') return 'boolean';
    if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';

    if ((value[0] === '[' && value[value.length - 1] === ']')
      || (value[0] === '{' && value[value.length - 1] === '}')) {
      try {
        JSON.parse(value);
        return 'json';
      } catch (_error) {
        return 'text';
      }
    }

    return 'text';
  }

  function shouldUseTextarea(value, type) {
    var stringValue = String(value == null ? '' : value);
    return type === 'json' || stringValue.length > 80 || stringValue.indexOf('\n') >= 0;
  }

  function formatUpdatedAt(timestamp) {
    if (!timestamp) return 'updated: unknown';
    var date = new Date(Number(timestamp));
    if (isNaN(date.getTime())) return 'updated: unknown';
    return 'updated: ' + date.toLocaleString();
  }

  function parseStringArray(value) {
    var parsed;
    try {
      parsed = JSON.parse(String(value == null ? '' : value));
    } catch (_error) {
      return { valid: false, values: [] };
    }

    if (!Array.isArray(parsed)) {
      return { valid: false, values: [] };
    }

    var deduped = [];
    for (var i = 0; i < parsed.length; i++) {
      var name = String(parsed[i] == null ? '' : parsed[i]).trim();
      if (!name) continue;
      if (deduped.indexOf(name) === -1) deduped.push(name);
    }

    return { valid: true, values: deduped };
  }

  function createRuntimeItem(key, value) {
    var item = document.createElement('div');
    item.className = 'runtime-item';

    var keySpan = document.createElement('span');
    keySpan.className = 'key';
    keySpan.textContent = key;
    item.appendChild(keySpan);

    var valueSpan = document.createElement('span');
    valueSpan.className = 'val';
    valueSpan.textContent = String(value);
    if (value === true) valueSpan.classList.add('true');
    if (value === false) valueSpan.classList.add('false');
    item.appendChild(valueSpan);

    return item;
  }

  function renderRuntimeConfig(runtime) {
    runtimeContainer.innerHTML = '';
    var keys = Object.keys(runtime || {}).sort();

    if (!keys.length) {
      runtimeContainer.innerHTML = '<p class="muted-text">No runtime values available.</p>';
      return;
    }

    for (var i = 0; i < keys.length; i++) {
      runtimeContainer.appendChild(createRuntimeItem(keys[i], runtime[keys[i]]));
    }
  }

  function getDefinition(settingKey) {
    return state.definitions[settingKey] || null;
  }

  function renderAddSettingHint(rawKey) {
    if (!newSettingHelp) return;

    var key = String(rawKey == null ? '' : rawKey).trim();
    if (!key) {
      newSettingHelp.textContent = 'Create a key/value pair. Use JSON when storing structured values.';
      return;
    }

    var definition = getDefinition(key);
    if (!definition) {
      newSettingHelp.textContent = 'This key has no built-in description. Values are stored as plain strings unless your code parses them.';
      return;
    }

    var parts = [];
    if (definition.description) parts.push(definition.description);
    if (definition.format) parts.push('Format: ' + definition.format + '.');
    if (definition.example) parts.push('Example: ' + definition.example + '.');
    newSettingHelp.textContent = parts.join(' ');
  }

  function createEmojiPreview(value) {
    var wrapper = document.createElement('div');
    wrapper.className = 'setting-preview';

    var parsed = parseStringArray(value);
    if (!parsed.valid) {
      var invalid = document.createElement('p');
      invalid.className = 'muted-text error-text';
      invalid.textContent = 'Expected a JSON array of emoji names (example: ["party_parrot","thonk"]).';
      wrapper.appendChild(invalid);
      return wrapper;
    }

    var names = parsed.values;
    if (!names.length) {
      var empty = document.createElement('p');
      empty.className = 'muted-text';
      empty.textContent = 'No emoji names currently stored.';
      wrapper.appendChild(empty);
      return wrapper;
    }

    var matchedCount = 0;
    for (var m = 0; m < names.length; m++) {
      if (state.emojiPreviewByName[names[m].toLowerCase()]) matchedCount++;
    }

    var summary = document.createElement('p');
    summary.className = 'muted-text';
    if (state.emojiPreviewMeta && state.emojiPreviewMeta.available) {
      summary.textContent = 'Previewing ' + names.length + ' names (' + matchedCount + ' matched in Discord application emojis).';
    } else {
      summary.textContent = 'Previewing ' + names.length + ' emoji name references.';
    }
    wrapper.appendChild(summary);

    var grid = document.createElement('div');
    grid.className = 'emoji-preview-grid';

    for (var i = 0; i < names.length; i++) {
      var originalName = names[i];
      var emoji = state.emojiPreviewByName[originalName.toLowerCase()] || null;

      var item = document.createElement('div');
      item.className = 'emoji-preview-item';
      if (!emoji) item.classList.add('missing');

      if (emoji && emoji.imageUrl) {
        var image = document.createElement('img');
        image.className = 'emoji-preview-image';
        image.src = emoji.imageUrl;
        image.alt = originalName;
        image.loading = 'lazy';
        item.appendChild(image);
      } else {
        var placeholder = document.createElement('span');
        placeholder.className = 'emoji-preview-placeholder';
        placeholder.textContent = '#';
        item.appendChild(placeholder);
      }

      var label = document.createElement('span');
      label.className = 'emoji-preview-name mono';
      label.textContent = ':' + originalName + ':';
      item.appendChild(label);

      grid.appendChild(item);
    }

    wrapper.appendChild(grid);
    return wrapper;
  }

  function createSettingEditor(settingValue, valueType) {
    var editor;
    if (shouldUseTextarea(settingValue, valueType)) {
      editor = document.createElement('textarea');
      editor.className = 'input input-textarea setting-editor';
      editor.rows = 3;
    } else {
      editor = document.createElement('input');
      editor.className = 'input setting-editor';
      editor.type = 'text';
    }

    editor.value = String(settingValue == null ? '' : settingValue);
    return editor;
  }

  function createSettingRow(setting) {
    var valueType = inferValueType(setting.value);
    var definition = getDefinition(setting.key);

    var row = document.createElement('article');
    row.className = 'setting-row';

    var header = document.createElement('div');
    header.className = 'setting-header';

    var keyLine = document.createElement('div');
    keyLine.className = 'setting-key-line';

    var keyEl = document.createElement('code');
    keyEl.className = 'setting-key mono';
    keyEl.textContent = setting.key;
    keyLine.appendChild(keyEl);

    var typeBadge = document.createElement('span');
    typeBadge.className = 'setting-type';
    typeBadge.textContent = valueType;
    keyLine.appendChild(typeBadge);

    header.appendChild(keyLine);

    var updated = document.createElement('div');
    updated.className = 'setting-updated muted-text';
    updated.textContent = formatUpdatedAt(setting.updatedAt);
    header.appendChild(updated);

    if (definition && definition.description) {
      var description = document.createElement('p');
      description.className = 'setting-description muted-text';
      description.textContent = definition.description;
      header.appendChild(description);
    }

    row.appendChild(header);

    var valueArea = document.createElement('div');
    valueArea.className = 'setting-value';

    var editor = createSettingEditor(setting.value, valueType);
    valueArea.appendChild(editor);

    var previewHost = null;
    if (setting.key === 'uploaded_emoji_names') {
      previewHost = document.createElement('div');
      previewHost.className = 'setting-preview-host';
      previewHost.appendChild(createEmojiPreview(editor.value));
      valueArea.appendChild(previewHost);

      editor.addEventListener('input', function () {
        previewHost.innerHTML = '';
        previewHost.appendChild(createEmojiPreview(editor.value));
      });
    }

    row.appendChild(valueArea);

    var actions = document.createElement('div');
    actions.className = 'setting-actions';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'button sm';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async function () {
      try {
        AdminApp.setStatus('Saving ' + setting.key + '...');
        await AdminApp.fetchJson('/api/settings/' + encodeURIComponent(setting.key), {
          method: 'PUT',
          body: JSON.stringify({ value: editor.value })
        });
        AdminApp.setStatus('Setting ' + setting.key + ' saved.');
        await loadSettings();
      } catch (error) {
        AdminApp.setStatus('Save failed: ' + error.message, true);
      }
    });
    actions.appendChild(saveBtn);

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
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    return row;
  }

  function renderBotSettings(settings) {
    botSettingsContainer.innerHTML = '';

    if (!settings.length) {
      botSettingsContainer.innerHTML = '<p class="muted-text">No bot settings stored yet.</p>';
      return;
    }

    var sortedSettings = settings.slice().sort(function (a, b) {
      return String(a.key).localeCompare(String(b.key));
    });

    for (var i = 0; i < sortedSettings.length; i++) {
      botSettingsContainer.appendChild(createSettingRow(sortedSettings[i]));
    }
  }

  function hydrateEmojiPreview(data) {
    state.emojiPreviewByName = {};
    state.emojiPreviewMeta = data.emojiPreview || null;

    if (!data.emojiPreview || !Array.isArray(data.emojiPreview.emojis)) {
      return;
    }

    for (var i = 0; i < data.emojiPreview.emojis.length; i++) {
      var emoji = data.emojiPreview.emojis[i];
      if (!emoji || !emoji.name) continue;
      state.emojiPreviewByName[String(emoji.name).toLowerCase()] = emoji;
    }
  }

  async function loadSettings() {
    try {
      var data = await AdminApp.fetchJson('/api/settings');
      state.definitions = mergeDefinitions(data.definitions || {});
      hydrateEmojiPreview(data);
      renderRuntimeConfig(data.runtime || {});
      renderBotSettings(data.settings || []);
      renderAddSettingHint(newSettingKeyInput ? newSettingKeyInput.value : '');
    } catch (error) {
      runtimeContainer.innerHTML = '<p class="muted-text">Failed to load settings.</p>';
      botSettingsContainer.innerHTML = '';
      AdminApp.setStatus('Failed to load settings: ' + error.message, true);
    }
  }

  if (newSettingKeyInput) {
    newSettingKeyInput.addEventListener('input', function () {
      renderAddSettingHint(newSettingKeyInput.value);
    });
  }

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
        renderAddSettingHint('');
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
