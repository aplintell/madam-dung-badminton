(function (global) {
  var Db = global.BadmintonDb;

  // ---- Players (port of PlayerService.java) ----

  function normalizeName(rawName) {
    var trimmed = (rawName || '').trim().replace(/\s+/g, ' ');
    var result = '';
    var startOfWord = true;
    for (var i = 0; i < trimmed.length; i++) {
      var c = trimmed.charAt(i);
      if (c === ' ') {
        result += c;
        startOfWord = true;
      } else if (startOfWord) {
        result += c.toUpperCase();
        startOfWord = false;
      } else {
        result += c.toLowerCase();
      }
    }
    return result;
  }

  var Players = {
    normalize: normalizeName,

    findAll: function () {
      return Db.getAll('players').then(function (list) {
        list.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
        return list;
      });
    },

    findOrCreate: function (rawName) {
      var name = normalizeName(rawName);
      var nameLower = name.toLowerCase();
      return Db.getAllByIndex('players', 'nameLower', nameLower).then(function (matches) {
        if (matches.length > 0) {
          return matches[0];
        }
        var player = { name: name, nameLower: nameLower };
        return Db.add('players', player).then(function (id) {
          player.id = id;
          return player;
        });
      });
    },

    /** Set of player ids that appear in at least one game (any day, decided or not, deleted or not). */
    idsWithGames: function () {
      return Db.getAll('games').then(function (games) {
        var ids = {};
        games.forEach(function (g) {
          ids[g.team1Player1Id] = true;
          ids[g.team1Player2Id] = true;
          ids[g.team2Player1Id] = true;
          ids[g.team2Player2Id] = true;
        });
        return ids;
      });
    },

    hasPlayedAnyGame: function (playerId) {
      return Db.getAll('games').then(function (games) {
        return games.some(function (g) {
          return g.team1Player1Id === playerId || g.team1Player2Id === playerId
            || g.team2Player1Id === playerId || g.team2Player2Id === playerId;
        });
      });
    },

    /** Deletes a player. Refuses (and leaves the player untouched) if they've ever played a game or are a member. */
    remove: function (playerId) {
      return Players.hasPlayedAnyGame(playerId).then(function (hasGames) {
        if (hasGames) {
          throw new Error('This player has already played a game and cannot be deleted');
        }
        return Db.getAll('members');
      }).then(function (members) {
        var isMember = members.some(function (m) {
          return m.playerId === playerId;
        });
        if (isMember) {
          throw new Error('Lông Thủ này đang là Thành Viên Cố Định, không thể xóa');
        }
        return Db.getAll('gameDays');
      }).then(function (days) {
        var isGuest = days.some(function (day) {
          return (day.guestPlayerIds || []).indexOf(playerId) !== -1;
        });
        if (isGuest) {
          throw new Error('Lông Thủ này đang là TV Vãng Lai của một Ngày Chơi, không thể xóa');
        }
        return Db.remove('players', playerId);
      });
    },

    /** Renames a player in place; every game they've played keeps referencing the same player id. */
    rename: function (playerId, rawNewName) {
      var newName = normalizeName(rawNewName);
      var newNameLower = newName.toLowerCase();
      return Db.get('players', playerId).then(function (player) {
        if (!player) {
          throw new Error('Player not found: ' + playerId);
        }
        if (player.nameLower === newNameLower) {
          player.name = newName;
          return Db.put('players', player).then(function () {
            return player;
          });
        }
        return Db.getAllByIndex('players', 'nameLower', newNameLower).then(function (matches) {
          if (matches.length > 0) {
            throw new Error('Another player already has this name');
          }
          player.name = newName;
          player.nameLower = newNameLower;
          return Db.put('players', player).then(function () {
            return player;
          });
        });
      });
    }
  };

  // ---- Game days (port of GameDayService.java) ----

  // The shared (Firebase) data keeps 1 year; the packaged Android app keeps 3 on the phone.
  var RETAINED_YEARS = global.CloudDb ? 1 : 3;
  // Giá Độ Nước / Set used until another value is typed in End Day.
  var DEFAULT_WATER_RATE = 8;
  // Tiền Cầu for a TV Vãng Lai until another amount is typed when adding one.
  var DEFAULT_GUEST_FEE = 80;

  function parseFee(raw) {
    var fee = parseFloat(raw);
    return fee >= 0 ? fee : null;
  }
  // Indexed by Date#getDay(), which starts the week on Sunday.
  var DAY_NAMES = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // "2026-09-24" -> "2026-09"
  function monthKeyOfDate(isoDate) {
    return (isoDate || '').slice(0, 7);
  }

  // "2026-10-05" -> 2 (a Monday is "Thứ 2"; Sunday comes out as 1)
  function dayThu(isoDate) {
    var parts = isoDate.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getDay() + 1;
  }

  // e.g. "Thứ 5, 24/9/2026"
  function formatDefaultDayName(date) {
    return DAY_NAMES[date.getDay()] + ', ' + date.getDate() + '/' + (date.getMonth() + 1) + '/' + date.getFullYear();
  }

  function toIsoDate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /**
   * Keeps only the last RETAINED_YEARS years of data, counted back from the newest Ngày Chơi in
   * the system (not from today), so nothing is lost just because the app wasn't used for a while.
   * Deletes older game days with their games and members of older months, then those month records.
   * Works from day dates rather than every game ever played, which in the shared (Firebase)
   * version would cost a read per game.
   */
  function pruneOldData() {
    return Promise.all([Db.getAll('gameDays'), Db.getAll('months'), Db.getAll('members')]).then(function (results) {
      var latestDate = null;
      results[0].forEach(function (day) {
        if (day.date && (latestDate === null || day.date > latestDate)) {
          latestDate = day.date;
        }
      });
      if (latestDate === null) {
        return;
      }
      var parts = latestDate.split('-');
      var cutoffDate = toIsoDate(new Date(parseInt(parts[0], 10) - RETAINED_YEARS, parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
      var cutoffMonthKey = monthKeyOfDate(cutoffDate);

      var oldDays = results[0].filter(function (day) {
        return day.date < cutoffDate;
      });
      var oldMonths = results[1].filter(function (month) {
        return month.key < cutoffMonthKey;
      });
      var oldMembers = results[2].filter(function (member) {
        return member.monthKey < cutoffMonthKey;
      });
      return Promise.all(oldDays.map(function (day) {
        return GameDays.remove(day.id);
      }).concat(oldMembers.map(function (member) {
        return Db.remove('members', member.id);
      }))).then(function () {
        return Promise.all(oldMonths.map(function (month) {
          return Db.remove('months', month.id);
        }));
      });
    });
  }

  var GameDays = {
    RETAINED_YEARS: RETAINED_YEARS,

    /** Creates a Ngày Chơi for the given date ("YYYY-MM-DD"). */
    createForDate: function (isoDate) {
      var parts = isoDate.split('-');
      var date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var day = {
        date: toIsoDate(date),
        name: formatDefaultDayName(date),
        createdAt: new Date().toISOString()
      };
      return Db.add('gameDays', day).then(function (id) {
        day.id = id;
        return pruneOldData().then(function () {
          return day;
        });
      });
    },

    /** Days whose date falls in the given month key ("YYYY-MM"), latest date first. */
    findForMonth: function (monthKey) {
      return Db.getAll('gameDays').then(function (all) {
        var inMonth = all.filter(function (day) {
          return monthKeyOfDate(day.date) === monthKey;
        });
        inMonth.sort(function (a, b) {
          if (a.date !== b.date) {
            return a.date < b.date ? 1 : -1;
          }
          return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
        });
        return inMonth;
      });
    },

    getOrThrow: function (id) {
      return Db.get('gameDays', id).then(function (day) {
        if (!day) {
          throw new Error('Day not found: ' + id);
        }
        return day;
      });
    },

    rename: function (day, newName) {
      var trimmed = (newName || '').trim();
      if (!trimmed) {
        return Promise.resolve(day);
      }
      day.name = trimmed;
      return Db.put('gameDays', day).then(function () {
        return day;
      });
    },

    /**
     * Remembers what was typed into the End Day price boxes for this day, as raw input
     * strings ({ shuttlecock, court, water, waterRate }) so an empty box stays empty rather than "0".
     * water is the Nước bill; waterRate (Giá Độ Nước / Set) is the per-set bet, kept under its own
     * key; waterRateSavedAt records when it last changed, for the default below.
     * Re-reads the day first so a concurrent rename isn't overwritten.
     */
    savePrices: function (dayId, prices) {
      return GameDays.getOrThrow(dayId).then(function (day) {
        var old = day.prices || {};
        var waterRate = prices.waterRate || '';
        day.prices = {
          shuttlecock: prices.shuttlecock || '',
          court: prices.court || '',
          water: prices.water || '',
          waterRate: waterRate,
          waterRateSavedAt: waterRate !== (old.waterRate || '') ? new Date().toISOString() : old.waterRateSavedAt
        };
        return Db.put('gameDays', day);
      });
    },

    /** Giá Độ Nước / Set to start with: the most recently changed rate on any day, otherwise 8. */
    defaultWaterRate: function () {
      return Db.getAll('gameDays').then(function (days) {
        var latest = null;
        days.forEach(function (day) {
          var p = day.prices;
          if (p && parseFloat(p.waterRate) >= 0 && p.waterRateSavedAt
              && (latest === null || p.waterRateSavedAt > latest.waterRateSavedAt)) {
            latest = p;
          }
        });
        return latest ? parseFloat(latest.waterRate) : DEFAULT_WATER_RATE;
      });
    },

    /** Players who may be put in a set today: TV Cố Định marked Chơi plus TV Vãng Lai. */
    playableToday: function (dayId) {
      return GameDays.roster(dayId).then(function (roster) {
        return roster.members.filter(function (m) {
          return m.playing;
        }).concat(roster.guests);
      });
    },

    /**
     * Who is down to play on the day:
     * - members: the month's Thành Viên Cố Định signed up for this day's weekday, each with
     *   playing = true unless marked Nghỉ for this day (day.restingMemberIds);
     * - guests: TV Vãng Lai added for this day only (day.guestPlayerIds), each with the Tiền Cầu
     *   they pay (day.guestFees[playerId].fee, or the default fee if none was saved).
     * thu is the day's "Thứ N" (see dayThu).
     */
    roster: function (dayId) {
      return GameDays.getOrThrow(dayId).then(function (day) {
        var thu = dayThu(day.date);
        return Promise.all([Members.findAllForMonth(monthKeyOfDate(day.date)), Players.findAll(), GameDays.defaultGuestFee()]).then(function (results) {
          var resting = day.restingMemberIds || [];
          var members = results[0].filter(function (m) {
            return m.weekdays.indexOf(thu) !== -1;
          }).map(function (m) {
            return { playerId: m.playerId, name: m.name, playing: resting.indexOf(m.playerId) === -1 };
          });
          var nameById = {};
          results[1].forEach(function (p) {
            nameById[p.id] = p.name;
          });
          var defaultGuestFee = results[2];
          var fees = day.guestFees || {};
          var guests = (day.guestPlayerIds || []).map(function (id) {
            return { playerId: id, name: nameById[id] || '', fee: fees[id] ? fees[id].fee : defaultGuestFee };
          });
          return { day: day, thu: thu, members: members, guests: guests, defaultGuestFee: defaultGuestFee };
        });
      });
    },

    /** Marks a member Chơi (playing) or Nghỉ (resting) for this day only. */
    setMemberPlaying: function (dayId, playerId, playing) {
      return GameDays.getOrThrow(dayId).then(function (day) {
        var resting = (day.restingMemberIds || []).filter(function (id) {
          return id !== playerId;
        });
        if (!playing) {
          resting.push(playerId);
        }
        day.restingMemberIds = resting;
        return Db.put('gameDays', day);
      });
    },

    /**
     * Tiền Cầu to suggest for a new TV Vãng Lai: the amount typed when the most recent guest was
     * added (on any day), otherwise 80. Later edits to a guest's amount don't change it.
     */
    defaultGuestFee: function () {
      return Db.getAll('gameDays').then(function (days) {
        var latest = null;
        days.forEach(function (day) {
          var fees = day.guestFees || {};
          Object.keys(fees).forEach(function (id) {
            if (latest === null || fees[id].savedAt > latest.savedAt) {
              latest = fees[id];
            }
          });
        });
        if (!latest) {
          return DEFAULT_GUEST_FEE;
        }
        return latest.addedFee !== undefined ? latest.addedFee : latest.fee;
      });
    },

    /**
     * Adds a TV Vãng Lai who joins this day only and pays fee as Tiền Cầu.
     * Refuses members already scheduled today.
     */
    addGuest: function (dayId, rawName, rawFee) {
      var name = normalizeName(rawName);
      if (!name) {
        return Promise.reject(new Error('Vui lòng nhập tên'));
      }
      var fee = parseFee(rawFee);
      if (fee === null) {
        return Promise.reject(new Error('Vui lòng nhập Tiền Cầu'));
      }
      return GameDays.roster(dayId).then(function (roster) {
        return Players.findOrCreate(name).then(function (player) {
          var isMember = roster.members.some(function (m) {
            return m.playerId === player.id;
          });
          if (isMember) {
            throw new Error(player.name + ' là TV Cố Định hôm nay, không cần thêm');
          }
          var isGuest = roster.guests.some(function (g) {
            return g.playerId === player.id;
          });
          if (isGuest) {
            throw new Error(player.name + ' đã có trong TV Vãng Lai');
          }
          var day = roster.day;
          day.guestPlayerIds = (day.guestPlayerIds || []).concat([player.id]);
          day.guestFees = day.guestFees || {};
          day.guestFees[player.id] = { fee: fee, addedFee: fee, savedAt: new Date().toISOString() };
          return Db.put('gameDays', day).then(function () {
            return player;
          });
        });
      });
    },

    /**
     * Changes the Tiền Cầu one TV Vãng Lai pays today. Only that guest changes: the default for new
     * guests (addedFee / savedAt) is left as it was.
     */
    setGuestFee: function (dayId, playerId, rawFee) {
      var fee = parseFee(rawFee);
      if (fee === null) {
        return Promise.reject(new Error('Vui lòng nhập Tiền Cầu'));
      }
      return GameDays.getOrThrow(dayId).then(function (day) {
        day.guestFees = day.guestFees || {};
        var entry = day.guestFees[playerId] || { addedFee: fee, savedAt: new Date().toISOString() };
        if (entry.addedFee === undefined) {
          entry.addedFee = entry.fee;
        }
        entry.fee = fee;
        day.guestFees[playerId] = entry;
        return Db.put('gameDays', day);
      });
    },

    removeGuest: function (dayId, playerId) {
      return GameDays.getOrThrow(dayId).then(function (day) {
        day.guestPlayerIds = (day.guestPlayerIds || []).filter(function (id) {
          return id !== playerId;
        });
        if (day.guestFees) {
          delete day.guestFees[playerId];
        }
        return Db.put('gameDays', day);
      });
    },

    /** Permanently deletes a day and every game recorded on it. Players are untouched. */
    remove: function (dayId) {
      return Db.getAllByIndex('games', 'gameDayId', dayId).then(function (games) {
        return Promise.all(games.map(function (g) {
          return Db.remove('games', g.id);
        }));
      }).then(function () {
        return Db.remove('gameDays', dayId);
      });
    }
  };

  // ---- Months ----

  var MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

  // "2026-09" -> "Tháng 9/2026"
  function formatMonthName(monthKey) {
    var m = MONTH_KEY_PATTERN.exec(monthKey);
    return 'Tháng ' + parseInt(m[2], 10) + '/' + m[1];
  }

  function newMonth(monthKey) {
    return { key: monthKey, name: formatMonthName(monthKey), createdAt: new Date().toISOString() };
  }

  var Months = {
    isValidKey: function (monthKey) {
      return MONTH_KEY_PATTERN.test(monthKey || '');
    },

    keyOfDate: monthKeyOfDate,

    formatName: formatMonthName,

    currentKey: function () {
      var now = new Date();
      return now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    },

    /** First and last date of the month: "2026-10" -> { first: "2026-10-01", last: "2026-10-31" } */
    dateRange: function (monthKey) {
      var m = MONTH_KEY_PATTERN.exec(monthKey);
      var lastDay = new Date(parseInt(m[1], 10), parseInt(m[2], 10), 0).getDate();
      return { first: monthKey + '-01', last: monthKey + '-' + pad2(lastDay) };
    },

    todayIsoDate: function () {
      return toIsoDate(new Date());
    },

    /**
     * Every month, newest first. Any month that has game days but no month record yet
     * (e.g. days recorded before months existed) gets a record created first, so no day is left out.
     * Data older than the retention window is pruned first.
     */
    findAll: function () {
      return pruneOldData().then(function () {
        return Promise.all([Db.getAll('months'), Db.getAll('gameDays')]);
      }).then(function (results) {
        var months = results[0];
        var existing = {};
        months.forEach(function (m) {
          existing[m.key] = true;
        });
        var missing = {};
        results[1].forEach(function (day) {
          var key = monthKeyOfDate(day.date);
          if (Months.isValidKey(key) && !existing[key]) {
            missing[key] = true;
          }
        });
        return Promise.all(Object.keys(missing).map(function (key) {
          var month = newMonth(key);
          return Db.add('months', month).then(function (id) {
            month.id = id;
            return month;
          });
        })).then(function (created) {
          var all = months.concat(created);
          all.sort(function (a, b) {
            return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
          });
          return all;
        });
      });
    },

    findByKey: function (monthKey) {
      return Db.getAllByIndex('months', 'key', monthKey).then(function (matches) {
        return matches[0] || null;
      });
    },

    /** "2026-12" -> "2027-01" */
    nextKey: function (monthKey) {
      var m = MONTH_KEY_PATTERN.exec(monthKey);
      var year = parseInt(m[1], 10);
      var month = parseInt(m[2], 10);
      return month === 12 ? (year + 1) + '-01' : year + '-' + pad2(month + 1);
    },

    /**
     * Creates a new month and copies in the members of the previous month (the latest existing
     * month before it), keeping their weekdays. Refuses if the month already exists.
     */
    create: function (monthKey) {
      if (!Months.isValidKey(monthKey)) {
        return Promise.reject(new Error('Vui lòng chọn tháng'));
      }
      return Db.getAll('months').then(function (months) {
        var exists = months.some(function (m) {
          return m.key === monthKey;
        });
        if (exists) {
          throw new Error(formatMonthName(monthKey) + ' đã tồn tại');
        }
        var previousKey = null;
        months.forEach(function (m) {
          if (m.key < monthKey && (previousKey === null || m.key > previousKey)) {
            previousKey = m.key;
          }
        });
        var month = newMonth(monthKey);
        return Db.add('months', month).then(function (id) {
          month.id = id;
          return previousKey === null ? [] : Db.getAllByIndex('members', 'monthKey', previousKey);
        }).then(function (previousMembers) {
          return Promise.all(previousMembers.map(function (pm) {
            return Db.add('members', {
              monthKey: monthKey,
              playerId: pm.playerId,
              weekdays: pm.weekdays.slice(),
              createdAt: new Date().toISOString()
            });
          }));
        }).then(function () {
          return month;
        });
      });
    },

    /** Permanently deletes a month together with its members and every game day (and game) in it. */
    remove: function (month) {
      return Promise.all([GameDays.findForMonth(month.key), Db.getAllByIndex('members', 'monthKey', month.key)]).then(function (results) {
        return Promise.all(results[0].map(function (day) {
          return GameDays.remove(day.id);
        }).concat(results[1].map(function (member) {
          return Db.remove('members', member.id);
        })));
      }).then(function () {
        return Db.remove('months', month.id);
      });
    }
  };

  // ---- Members (Thành Viên Cố Định): players who pay up front for fixed weekdays in a month ----

  // Weekdays a member can sign up for, in the "Thứ N" numbering (2 = Monday).
  var MEMBER_WEEKDAYS = [2, 4, 6];

  // Fixed court booking for member days: hours booked per session. Fixed values, not user-editable.
  var COURT_SCHEDULE = [
    { weekday: 2, hours: 4 },
    { weekday: 4, hours: 4 },
    { weekday: 6, hours: 4 }
  ];

  // Phí Thuê Sân / Giờ used until one has been entered for an earlier month.
  var DEFAULT_COURT_RATE = 70;

  // [2, 4, 6] -> "Thứ 2, 4, 6"
  function formatWeekdays(weekdays) {
    return 'Thứ ' + weekdays.join(', ');
  }

  var Members = {
    WEEKDAYS: MEMBER_WEEKDAYS,

    formatWeekdays: formatWeekdays,

    /** Members of the month with their current player name attached: most days first, then name A-Z. */
    findAllForMonth: function (monthKey) {
      return Promise.all([Db.getAllByIndex('members', 'monthKey', monthKey), Players.findAll()]).then(function (results) {
        var nameById = {};
        results[1].forEach(function (p) {
          nameById[p.id] = p.name;
        });
        var members = results[0].map(function (m) {
          m.name = nameById[m.playerId] || '';
          return m;
        });
        members.sort(function (a, b) {
          if (b.weekdays.length !== a.weekdays.length) {
            return b.weekdays.length - a.weekdays.length;
          }
          return a.name.localeCompare(b.name, 'vi');
        });
        return members;
      });
    },

    /**
     * Adds a member to the month, or updates memberId when given. The name is matched to an
     * existing player (or creates one), so a member is the same person as in the game list.
     */
    save: function (monthKey, rawName, weekdays, memberId) {
      var name = normalizeName(rawName);
      if (!name) {
        return Promise.reject(new Error('Vui lòng nhập tên'));
      }
      var days = MEMBER_WEEKDAYS.filter(function (d) {
        return weekdays.indexOf(d) !== -1;
      });
      if (days.length === 0) {
        return Promise.reject(new Error('Vui lòng chọn ít nhất 1 ngày'));
      }
      return Players.findOrCreate(name).then(function (player) {
        return Db.getAllByIndex('members', 'monthKey', monthKey).then(function (members) {
          var duplicate = members.some(function (m) {
            return m.playerId === player.id && m.id !== memberId;
          });
          if (duplicate) {
            throw new Error(player.name + ' đã là Thành Viên trong tháng này');
          }
          var existing = members.filter(function (m) {
            return m.id === memberId;
          })[0];
          var member = existing || { monthKey: monthKey, createdAt: new Date().toISOString() };
          member.playerId = player.id;
          member.weekdays = days;
          var write = existing ? Db.put('members', member) : Db.add('members', member);
          return write.then(function (id) {
            member.id = id;
            member.name = player.name;
            return member;
          });
        });
      });
    },

    remove: function (memberId) {
      return Db.remove('members', memberId);
    },

    /** How many of each member weekday fall in the month, e.g. { 2: 4, 4: 4, 6: 5 }. */
    countWeekdaysInMonth: function (monthKey) {
      var m = MONTH_KEY_PATTERN.exec(monthKey);
      var year = parseInt(m[1], 10);
      var monthIndex = parseInt(m[2], 10) - 1;
      var daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      var counts = {};
      MEMBER_WEEKDAYS.forEach(function (d) {
        counts[d] = 0;
      });
      for (var day = 1; day <= daysInMonth; day++) {
        // Date#getDay() is 0 for Sunday, so "Thứ N" is getDay() + 1.
        var thu = new Date(year, monthIndex, day).getDay() + 1;
        if (counts[thu] !== undefined) {
          counts[thu]++;
        }
      }
      return counts;
    },

    /**
     * The Phí Thuê Sân / Giờ to show for the month: its own saved rate, otherwise the rate of the
     * latest earlier month that has one (so a changed rate carries forward), otherwise 70.
     */
    courtRateFor: function (monthKey) {
      return Db.getAll('months').then(function (months) {
        var best = null;
        months.forEach(function (m) {
          if (m.courtRate > 0 && m.key <= monthKey && (best === null || m.key > best.key)) {
            best = m;
          }
        });
        return best ? best.courtRate : DEFAULT_COURT_RATE;
      });
    },

    saveCourtRate: function (monthKey, rate) {
      return Months.findByKey(monthKey).then(function (month) {
        month = month || newMonth(monthKey);
        month.courtRate = rate;
        return Db.put('months', month);
      });
    },

    /**
     * Works out the month's court cost (hours x Phí Thuê Sân / Giờ for every Thứ 2, 4, 6 date) and
     * splits it across members by how many sessions each signs up for: a member's sessions are the
     * number of their chosen weekdays in the month, and every session costs the same (rounded up,
     * like the End Day split).
     */
    settleFee: function (monthKey, courtRate) {
      return Members.findAllForMonth(monthKey).then(function (members) {
        if (members.length === 0) {
          throw new Error('Chưa có Thành Viên trong tháng này');
        }
        var weekdayCounts = Members.countWeekdaysInMonth(monthKey);
        var totalSessions = 0;
        var rows = members.map(function (m) {
          var sessions = 0;
          m.weekdays.forEach(function (d) {
            sessions += weekdayCounts[d] || 0;
          });
          totalSessions += sessions;
          return { name: m.name, weekdays: m.weekdays, sessions: sessions };
        });
        var courtTotal = 0;
        var courtRows = COURT_SCHEDULE.map(function (c) {
          var sessions = weekdayCounts[c.weekday] || 0;
          var cost = c.hours * courtRate;
          courtTotal += cost * sessions;
          return { weekday: c.weekday, hours: c.hours, cost: cost, sessions: sessions, total: cost * sessions };
        });
        var costPerSession = totalSessions === 0 ? 0 : Math.ceil(courtTotal / totalSessions);
        rows.forEach(function (r) {
          r.amount = r.sessions * costPerSession;
        });
        return {
          courtRate: courtRate,
          weekdayCounts: weekdayCounts,
          courtRows: courtRows,
          courtTotal: courtTotal,
          totalSessions: totalSessions,
          costPerSession: costPerSession,
          members: rows
        };
      });
    }
  };

  // ---- Games (port of GameService.java) ----

  var Games = {
    findAllForDay: function (gameDayId) {
      return Db.getAllByIndex('games', 'gameDayId', gameDayId).then(function (games) {
        var active = games.filter(function (g) {
          return !g.deletedAt;
        });
        active.sort(function (a, b) {
          return b.id - a.id;
        });
        return active;
      });
    },

    addGame: function (gameDayId, team1Player1Name, team1Player2Name, team2Player1Name, team2Player2Name) {
      var names = [team1Player1Name, team1Player2Name, team2Player1Name, team2Player2Name].map(normalizeName);
      var distinct = {};
      names.forEach(function (n) {
        distinct[n.toLowerCase()] = true;
      });
      if (Object.keys(distinct).length < 4) {
        return Promise.reject(new Error('Each player can only appear once in a game'));
      }
      return GameDays.playableToday(gameDayId).then(function (playable) {
        var allowed = {};
        playable.forEach(function (p) {
          allowed[p.name.toLowerCase()] = true;
        });
        var outsider = names.filter(function (n) {
          return !allowed[n.toLowerCase()];
        })[0];
        if (outsider) {
          throw new Error(outsider + ' không có trong TV Cố Định / TV Vãng Lai hôm nay');
        }
        return Promise.all(names.map(Players.findOrCreate));
      }).then(function (players) {
        var game = {
          gameDayId: gameDayId,
          team1Player1Id: players[0].id,
          team1Player2Id: players[1].id,
          team2Player1Id: players[2].id,
          team2Player2Id: players[3].id,
          winningTeam: null,
          createdAt: new Date().toISOString(),
          deletedAt: null
        };
        return Db.add('games', game).then(function (id) {
          game.id = id;
          return game;
        });
      });
    },

    getOrThrow: function (id) {
      return Db.get('games', id).then(function (g) {
        if (!g) {
          throw new Error('Game not found: ' + id);
        }
        return g;
      });
    },

    setWinner: function (game, winningTeam) {
      game.winningTeam = winningTeam;
      return Db.put('games', game).then(function () {
        return game;
      });
    },

    duplicate: function (game) {
      var copy = {
        gameDayId: game.gameDayId,
        team1Player1Id: game.team1Player1Id,
        team1Player2Id: game.team1Player2Id,
        team2Player1Id: game.team2Player1Id,
        team2Player2Id: game.team2Player2Id,
        winningTeam: null,
        createdAt: new Date().toISOString(),
        deletedAt: null
      };
      return Db.add('games', copy).then(function (id) {
        copy.id = id;
        return copy;
      });
    },

    delete: function (game) {
      game.deletedAt = new Date().toISOString();
      return Db.put('games', game).then(function () {
        return game;
      });
    },

    hasDeletedGames: function (gameDayId) {
      return Db.getAllByIndex('games', 'gameDayId', gameDayId).then(function (games) {
        return games.some(function (g) {
          return !!g.deletedAt;
        });
      });
    },

    undoLastDelete: function (gameDayId) {
      return Db.getAllByIndex('games', 'gameDayId', gameDayId).then(function (games) {
        var deleted = games.filter(function (g) {
          return !!g.deletedAt;
        });
        if (deleted.length === 0) {
          throw new Error('No deleted game to restore');
        }
        deleted.sort(function (a, b) {
          return a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0;
        });
        var game = deleted[0];
        game.deletedAt = null;
        return Db.put('games', game).then(function () {
          return game;
        });
      });
    }
  };

  // ---- Settlement (port of SettlementService.java) ----

  var Settlement = {
    /**
     * Tiền Cầu: each TV Vãng Lai pays the fee entered for them (Đã Thu Vãng Lai is their total);
     * Phát Sinh = (Cầu + Sân + Nước) - Đã Thu Vãng Lai is split evenly (rounded up) between today's
     * TV Cố Định who are marked Chơi. Anyone else who played without being added pays the default
     * TV Vãng Lai fee.
     * Water bet: at waterRate (Giá Độ Nước / Set) each lost set adds waterRate and each won set
     * takes waterRate off, so it can come out negative for players who won more than they lost.
     */
    settle: function (gameDayId, shuttlecockPrice, courtPrice, waterPrice, waterRate) {
      return Promise.all([Games.findAllForDay(gameDayId), GameDays.roster(gameDayId)]).then(function (results) {
        var games = results[0];
        var feeByGuestId = {};
        results[1].guests.forEach(function (g) {
          feeByGuestId[g.playerId] = g.fee;
        });
        var defaultGuestFee = results[1].defaultGuestFee;
        var memberIds = results[1].members.filter(function (m) {
          return m.playing;
        }).map(function (m) {
          return m.playerId;
        });
        if (games.length === 0 && memberIds.length === 0) {
          throw new Error('No games recorded for this day yet');
        }
        var decidedGames = games.filter(function (g) {
          return g.winningTeam !== null && g.winningTeam !== undefined;
        });

        var total = shuttlecockPrice + courtPrice + waterPrice;
        if (total > 0 && memberIds.length === 0) {
          throw new Error('Không có TV Cố Định (Chơi) hôm nay để chia Tiền Cầu');
        }

        // Đã Thu Vãng Lai: the Tiền Cầu entered for today's TV Vãng Lai.
        var guestPaidTotal = results[1].guests.reduce(function (sum, g) {
          return sum + g.fee;
        }, 0);
        var extraCost = total - guestPaidTotal;
        var memberShare = memberIds.length === 0 ? 0 : Math.ceil(extraCost / memberIds.length);

        return Players.findAll().then(function (allPlayers) {
          var nameById = {};
          allPlayers.forEach(function (p) {
            nameById[p.id] = p.name;
          });

          var byPlayer = {};
          function agg(id) {
            if (!byPlayer[id]) {
              byPlayer[id] = { name: nameById[id], gamesPlayed: 0, gamesLost: 0, gamesWon: 0 };
            }
            return byPlayer[id];
          }

          // Everyone on today's lists is settled even before playing a set: TV Cố Định (Chơi) pay
          // their share of Phát Sinh, TV Vãng Lai pay the amount entered for them.
          memberIds.forEach(agg);
          results[1].guests.forEach(function (g) {
            agg(g.playerId);
          });
          games.forEach(function (g) {
            [g.team1Player1Id, g.team1Player2Id, g.team2Player1Id, g.team2Player2Id].forEach(function (id) {
              agg(id).gamesPlayed++;
            });
          });
          decidedGames.forEach(function (g) {
            var team1 = [g.team1Player1Id, g.team1Player2Id];
            var team2 = [g.team2Player1Id, g.team2Player2Id];
            var winnerIds = g.winningTeam === 1 ? team1 : team2;
            var loserIds = g.winningTeam === 1 ? team2 : team1;
            loserIds.forEach(function (id) {
              agg(id).gamesLost++;
            });
            winnerIds.forEach(function (id) {
              agg(id).gamesWon++;
            });
          });

          var shares = Object.keys(byPlayer).map(function (id) {
            var a = byPlayer[id];
            var isMember = memberIds.indexOf(parseInt(id, 10)) !== -1;
            var courtShare = isMember ? memberShare
              : (feeByGuestId[id] !== undefined ? feeByGuestId[id] : defaultGuestFee);
            var waterShare = waterRate * a.gamesLost - waterRate * a.gamesWon;
            return {
              name: a.name,
              isMember: isMember,
              gamesPlayed: a.gamesPlayed,
              gamesLost: a.gamesLost,
              gamesWon: a.gamesWon,
              courtShare: courtShare,
              waterShare: waterShare,
              amount: courtShare + waterShare
            };
          });
          shares.sort(function (x, y) {
            if (y.amount !== x.amount) {
              return y.amount - x.amount;
            }
            return x.name.localeCompare(y.name, 'vi');
          });

          return {
            totalPrice: total,
            gameCount: games.length,
            memberCount: memberIds.length,
            memberShare: memberShare,
            guestPaidTotal: guestPaidTotal,
            extraCost: extraCost,
            waterRate: waterRate,
            players: shares
          };
        });
      });
    }
  };

  global.Players = Players;
  global.GameDays = GameDays;
  global.Months = Months;
  global.Members = Members;
  global.Games = Games;
  global.Settlement = Settlement;
})(window);
