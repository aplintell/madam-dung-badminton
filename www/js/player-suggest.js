(function (global) {
  // "Đạt" -> "dat": lets "dat" match "Đạt" while typing.
  function fold(text) {
    return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  }

  /**
   * Turns a text input into a name picker with a short, scrollable suggestion list (the native
   * <datalist> dropdown can't be sized on Android and covers the whole screen).
   * loadNames() returns a Promise of the names to offer; it's called each time the input gets focus.
   */
  function attach(input, loadNames) {
    var combo = document.createElement('div');
    combo.className = 'player-combo';
    input.parentNode.insertBefore(combo, input);
    combo.appendChild(input);

    var list = document.createElement('ul');
    list.className = 'player-suggestions';
    list.hidden = true;
    combo.appendChild(list);

    var names = [];

    function render() {
      var query = fold(input.value.trim());
      var matches = names.filter(function (name) {
        return !query || fold(name).indexOf(query) !== -1;
      });
      list.innerHTML = '';
      matches.forEach(function (name) {
        var li = document.createElement('li');
        li.className = 'player-suggestion';
        var span = document.createElement('span');
        span.className = 'player-suggestion-name';
        span.textContent = name;
        li.appendChild(span);
        li.addEventListener('click', function () {
          input.value = name;
          list.hidden = true;
        });
        list.appendChild(li);
      });
      list.hidden = matches.length === 0;
    }

    input.setAttribute('autocomplete', 'off');
    input.addEventListener('focus', function () {
      loadNames().then(function (loaded) {
        names = loaded;
        if (document.activeElement === input) {
          render();
        }
      });
    });
    input.addEventListener('input', render);
    input.addEventListener('blur', function () {
      list.hidden = true;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        list.hidden = true;
      }
    });
    // Keep focus in the input while a suggestion is tapped, so blur doesn't hide the list first.
    list.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });

    return {
      hide: function () {
        list.hidden = true;
      }
    };
  }

  global.PlayerSuggest = { attach: attach, fold: fold };
})(window);
