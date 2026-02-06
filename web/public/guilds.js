/* guilds.js -- Guild management tab with invite links */
(function () {
  'use strict';

  var mainGuildsBody = document.getElementById('main-guilds-body');
  var readerGuildsBody = document.getElementById('reader-guilds-body');
  var readerGuildsStatus = document.getElementById('reader-guilds-status');
  var readerGuildsWrapper = document.getElementById('reader-guilds-wrapper');
  var inviteCards = document.getElementById('invite-cards');

  // -- Invite cards --
  function renderInviteCards(botInfo) {
    inviteCards.innerHTML = '';

    // Main bot card
    var mainCard = document.createElement('div');
    mainCard.className = 'stat-card invite-card';

    var mainTitle = document.createElement('div');
    mainTitle.className = 'invite-title';
    mainTitle.textContent = botInfo.mainBot.username || 'Main Bot';
    mainCard.appendChild(mainTitle);

    var mainId = document.createElement('div');
    mainId.className = 'muted-text mono invite-id';
    mainId.textContent = botInfo.mainBot.id || '--';
    mainCard.appendChild(mainId);

    // Main bot uses OAuth2 code grant flow via /admin/bot-invite
    var mainBtn = document.createElement('a');
    mainBtn.className = 'button sm';
    mainBtn.href = '/admin/bot-invite';
    mainBtn.textContent = 'Invite Main Bot';
    mainCard.appendChild(mainBtn);

    inviteCards.appendChild(mainCard);

    // Reader bot card
    var readerCard = document.createElement('div');
    readerCard.className = 'stat-card invite-card';

    var readerTitle = document.createElement('div');
    readerTitle.className = 'invite-title';
    readerTitle.textContent = botInfo.readerBot.username || 'Reader Bot';
    readerCard.appendChild(readerTitle);

    if (!botInfo.readerBot.enabled) {
      var disabledLabel = document.createElement('div');
      disabledLabel.className = 'muted-text invite-state';
      disabledLabel.textContent = 'Disabled in config';
      readerCard.appendChild(disabledLabel);
    } else if (!botInfo.readerBot.online) {
      var offlineLabel = document.createElement('div');
      offlineLabel.className = 'muted-text invite-state';
      offlineLabel.textContent = 'Offline';
      readerCard.appendChild(offlineLabel);
    } else {
      var readerId = document.createElement('div');
      readerId.className = 'muted-text mono invite-id';
      readerId.textContent = botInfo.readerBot.id || '--';
      readerCard.appendChild(readerId);

      if (botInfo.readerBot.inviteUrl) {
        var readerBtn = document.createElement('a');
        readerBtn.className = 'button secondary sm';
        readerBtn.href = botInfo.readerBot.inviteUrl;
        readerBtn.target = '_blank';
        readerBtn.rel = 'noopener noreferrer';
        readerBtn.textContent = 'Invite Reader Bot';
        readerCard.appendChild(readerBtn);
      }
    }

    inviteCards.appendChild(readerCard);
  }

  async function loadInviteCards() {
    try {
      var data = await AdminApp.fetchJson('/api/bot-info');
      renderInviteCards(data);
    } catch (error) {
      inviteCards.innerHTML = '<div class="stat-card"><span class="muted-text">Failed to load bot info</span></div>';
    }
  }

  // -- Guild table helpers --
  function setTableMessage(tbody, message) {
    tbody.innerHTML = '';
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'muted-text';
    cell.textContent = message;
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  function formatDate(iso) {
    if (!iso) return '--';
    var d = new Date(iso);
    return d.toLocaleDateString();
  }

  /**
   * Render a guild table for either bot.
   * @param {Array} guilds - Array of guild objects
   * @param {HTMLElement} tbody - Target tbody element
   * @param {string} botType - 'main' or 'reader'
   */
  function renderGuildTable(guilds, tbody, botType) {
    tbody.innerHTML = '';

    if (!guilds.length) {
      setTableMessage(tbody, botType === 'main'
        ? 'Main bot is not in any guilds.'
        : 'Reader bot is not in any guilds.');
      return;
    }

    for (var i = 0; i < guilds.length; i++) {
      (function (guild) {
        var row = document.createElement('tr');

        // Icon
        var iconCell = document.createElement('td');
        iconCell.className = 'guild-icon-cell';
        if (guild.icon) {
          var img = document.createElement('img');
          img.src = guild.icon;
          img.alt = '';
          img.className = 'guild-icon';
          iconCell.appendChild(img);
        } else {
          var placeholder = document.createElement('div');
          placeholder.className = 'guild-icon-placeholder';
          iconCell.appendChild(placeholder);
        }
        row.appendChild(iconCell);

        // Name
        var nameCell = document.createElement('td');
        nameCell.textContent = guild.name;
        nameCell.className = 'guild-name';
        row.appendChild(nameCell);

        // ID
        var idCell = document.createElement('td');
        idCell.className = 'mono guild-id';
        idCell.textContent = guild.id;
        row.appendChild(idCell);

        // Members
        var membersCell = document.createElement('td');
        membersCell.textContent = guild.memberCount != null ? String(guild.memberCount) : '--';
        row.appendChild(membersCell);

        // Owner
        var ownerCell = document.createElement('td');
        ownerCell.className = 'guild-owner';
        if (guild.owner) {
          ownerCell.textContent = guild.owner;
          ownerCell.title = guild.ownerId || '';
        } else {
          ownerCell.className = 'mono';
          ownerCell.textContent = guild.ownerId || '--';
        }
        row.appendChild(ownerCell);

        // Joined
        var joinedCell = document.createElement('td');
        joinedCell.textContent = formatDate(guild.joinedAt);
        row.appendChild(joinedCell);

        // Actions
        var actionsCell = document.createElement('td');
        var leaveBtn = document.createElement('button');
        leaveBtn.className = 'button secondary sm danger';
        leaveBtn.textContent = 'Leave';
        leaveBtn.addEventListener('click', async function () {
          var botLabel = botType === 'reader' ? 'reader bot' : 'bot';
          if (!confirm('Leave guild "' + guild.name + '" (' + guild.id + ')?\n\nThe ' + botLabel + ' will lose access to all channels in this server. This cannot be undone from here.')) {
            return;
          }
          try {
            AdminApp.setStatus('Leaving guild ' + guild.name + '...');
            var url = '/api/guilds/' + guild.id + '/leave';
            if (botType === 'reader') url += '?bot=reader';
            var result = await AdminApp.fetchJson(url, { method: 'POST' });
            AdminApp.setStatus('Left guild "' + (result.guildName || guild.name) + '".');
            await loadGuilds();
          } catch (error) {
            AdminApp.setStatus('Leave failed: ' + error.message, true);
          }
        });
        actionsCell.appendChild(leaveBtn);
        row.appendChild(actionsCell);

        tbody.appendChild(row);
      })(guilds[i]);
    }
  }

  async function loadGuilds() {
    setTableMessage(mainGuildsBody, 'Loading...');
    setTableMessage(readerGuildsBody, 'Loading...');

    try {
      var data = await AdminApp.fetchJson('/api/guilds');

      // Main bot guilds
      var mainGuilds = (data.mainBot && data.mainBot.guilds) || [];
      renderGuildTable(mainGuilds, mainGuildsBody, 'main');

      // Reader bot guilds
      if (!data.readerBot || !data.readerBot.enabled) {
        readerGuildsStatus.textContent = 'Reader bot is disabled in config.';
        readerGuildsWrapper.classList.add('is-hidden');
      } else if (!data.readerBot.online) {
        readerGuildsStatus.textContent = 'Reader bot is offline.';
        readerGuildsWrapper.classList.add('is-hidden');
      } else {
        readerGuildsStatus.textContent = 'Servers the reader bot is currently in.';
        readerGuildsWrapper.classList.remove('is-hidden');
        var readerGuilds = data.readerBot.guilds || [];
        renderGuildTable(readerGuilds, readerGuildsBody, 'reader');
      }
    } catch (error) {
      setTableMessage(mainGuildsBody, 'Failed to load guilds: ' + error.message);
      setTableMessage(readerGuildsBody, '');
    }
  }

  AdminApp.onTabActivate('guilds', function () {
    loadInviteCards();
    loadGuilds();
  });
})();
