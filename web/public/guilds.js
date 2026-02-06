/* guilds.js -- Guild management tab */
(function () {
  'use strict';

  var guildsBody = document.getElementById('guilds-body');

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
    loadGuilds();
  });
})();
