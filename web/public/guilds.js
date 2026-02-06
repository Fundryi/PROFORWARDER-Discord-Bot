/* guilds.js -- Guild management tab with invite links */
(function () {
  'use strict';

  var guildsBody = document.getElementById('guilds-body');
  var inviteCards = document.getElementById('invite-cards');

  // -- Invite cards --
  function renderInviteCards(botInfo) {
    inviteCards.innerHTML = '';

    // Main bot card
    var mainCard = document.createElement('div');
    mainCard.className = 'stat-card';
    mainCard.style.textAlign = 'left';

    var mainTitle = document.createElement('div');
    mainTitle.style.fontWeight = '600';
    mainTitle.style.marginBottom = '6px';
    mainTitle.textContent = botInfo.mainBot.username || 'Main Bot';
    mainCard.appendChild(mainTitle);

    var mainId = document.createElement('div');
    mainId.className = 'muted-text';
    mainId.style.fontSize = '11px';
    mainId.style.marginBottom = '10px';
    mainId.textContent = botInfo.mainBot.id || '--';
    mainCard.appendChild(mainId);

    if (botInfo.mainBot.inviteUrl) {
      var mainBtn = document.createElement('a');
      mainBtn.className = 'button sm';
      mainBtn.href = botInfo.mainBot.inviteUrl;
      mainBtn.target = '_blank';
      mainBtn.rel = 'noopener noreferrer';
      mainBtn.textContent = 'Invite Main Bot';
      mainCard.appendChild(mainBtn);
    } else {
      var mainNA = document.createElement('span');
      mainNA.className = 'muted-text';
      mainNA.textContent = 'Bot not ready';
      mainCard.appendChild(mainNA);
    }

    inviteCards.appendChild(mainCard);

    // Reader bot card
    var readerCard = document.createElement('div');
    readerCard.className = 'stat-card';
    readerCard.style.textAlign = 'left';

    var readerTitle = document.createElement('div');
    readerTitle.style.fontWeight = '600';
    readerTitle.style.marginBottom = '6px';
    readerTitle.textContent = botInfo.readerBot.username || 'Reader Bot';
    readerCard.appendChild(readerTitle);

    if (!botInfo.readerBot.enabled) {
      var disabledLabel = document.createElement('div');
      disabledLabel.className = 'muted-text';
      disabledLabel.style.fontSize = '12px';
      disabledLabel.textContent = 'Disabled in config';
      readerCard.appendChild(disabledLabel);
    } else if (!botInfo.readerBot.online) {
      var offlineLabel = document.createElement('div');
      offlineLabel.className = 'muted-text';
      offlineLabel.style.fontSize = '12px';
      offlineLabel.textContent = 'Offline';
      readerCard.appendChild(offlineLabel);
    } else {
      var readerId = document.createElement('div');
      readerId.className = 'muted-text';
      readerId.style.fontSize = '11px';
      readerId.style.marginBottom = '10px';
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

  // -- Guild table --
  function setGuildsMessage(message) {
    guildsBody.innerHTML = '';
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'muted-text';
    cell.textContent = message;
    row.appendChild(cell);
    guildsBody.appendChild(row);
  }

  function formatDate(iso) {
    if (!iso) return '--';
    var d = new Date(iso);
    return d.toLocaleDateString();
  }

  function renderGuilds(guilds) {
    guildsBody.innerHTML = '';

    if (!guilds.length) {
      setGuildsMessage('Bot is not in any guilds.');
      return;
    }

    for (var i = 0; i < guilds.length; i++) {
      (function (guild) {
        var row = document.createElement('tr');

        // Name
        var nameCell = document.createElement('td');
        nameCell.textContent = guild.name;
        nameCell.style.fontWeight = '500';
        row.appendChild(nameCell);

        // ID
        var idCell = document.createElement('td');
        idCell.className = 'mono';
        idCell.style.fontSize = '12px';
        idCell.textContent = guild.id;
        row.appendChild(idCell);

        // Members
        var membersCell = document.createElement('td');
        membersCell.textContent = guild.memberCount != null ? String(guild.memberCount) : '--';
        row.appendChild(membersCell);

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
          if (!confirm('Leave guild "' + guild.name + '" (' + guild.id + ')?\n\nThe bot will lose access to all channels in this server. This cannot be undone from here.')) {
            return;
          }
          try {
            AdminApp.setStatus('Leaving guild ' + guild.name + '...');
            var result = await AdminApp.fetchJson('/api/guilds/' + guild.id + '/leave', { method: 'POST' });
            AdminApp.setStatus('Left guild "' + (result.guildName || guild.name) + '".');
            await loadGuilds();
          } catch (error) {
            AdminApp.setStatus('Leave failed: ' + error.message, true);
          }
        });
        actionsCell.appendChild(leaveBtn);
        row.appendChild(actionsCell);

        guildsBody.appendChild(row);
      })(guilds[i]);
    }
  }

  async function loadGuilds() {
    setGuildsMessage('Loading...');
    try {
      var data = await AdminApp.fetchJson('/api/guilds');
      renderGuilds(data.guilds || []);
    } catch (error) {
      setGuildsMessage('Failed to load guilds: ' + error.message);
    }
  }

  AdminApp.onTabActivate('guilds', function () {
    loadInviteCards();
    loadGuilds();
  });
})();
