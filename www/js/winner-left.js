(function (global) {
  // Game list rows show the winning team on the left and the losing team on the right. A row is
  // rearranged only 15 seconds after its result was last changed, so a team doesn't jump away
  // straight after being tapped (and tapping again to undo still hits the same spot). Only the
  // display moves: the saved teams stay as they are, and each team keeps its data-team number.
  var DELAY_MS = 15000;

  function teamsOf(content) {
    return content.querySelectorAll('.team');
  }

  // Puts the row's winning team on the left now (no change if there's no winner yet). Waits
  // while a finger is on the screen, so the teams never move under a tap.
  function placeNow(row) {
    if (global.TouchGuard && global.TouchGuard.isTouching()) {
      row._winnerLeftTimer = setTimeout(function () {
        placeNow(row);
      }, 1000);
      return;
    }
    var content = row.querySelector('.game-row-content');
    var teams = teamsOf(content);
    var winner = content.querySelector('.team.winner');
    if (!winner || winner === teams[0]) {
      return;
    }
    var left = teams[0];
    content.insertBefore(winner, left);
    content.appendChild(left);
    teams = teamsOf(content);
    teams[0].classList.remove('team-right');
    teams[0].classList.add('team-left');
    teams[1].classList.remove('team-left');
    teams[1].classList.add('team-right');
  }

  global.WinnerLeft = {
    /**
     * Schedules the row's rearrangement for 15s after changedAt (an ISO time; missing or invalid
     * means long ago, so it happens straight away). Replaces any earlier schedule for the row.
     */
    schedule: function (row, changedAt) {
      clearTimeout(row._winnerLeftTimer);
      var at = Date.parse(changedAt || '');
      var wait = isNaN(at) ? 0 : at + DELAY_MS - Date.now();
      if (wait <= 0) {
        placeNow(row);
      } else {
        row._winnerLeftTimer = setTimeout(function () {
          placeNow(row);
        }, Math.min(wait, DELAY_MS));
      }
    }
  };
})(window);
