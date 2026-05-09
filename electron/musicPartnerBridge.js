function createMusicPartnerBridgeScript({ nickname = '', userId = '' } = {}) {
  return `
    (function() {
      var BRIDGE_VERSION = 'audio-v6-20260509';
      if (window.__bridgeMockVersion === BRIDGE_VERSION) return;
      window.__bridgeMockInjected = true;
      window.__bridgeMockVersion = BRIDGE_VERSION;
      console.log('[BridgeMock] installed version:', BRIDGE_VERSION);

      // 在 preload 上下文（contextIsolation=false）中，require('electron') 可用
      var _electron = null;
      try { _electron = require('electron'); } catch(e) {}
      var _audioState = {
        src: '',
        playing: false,
        startAt: 0,
        currentTime: 0,
        duration: 180,
        timer: null,
        progressTimer: null
      };
      var _audioElement = null;
      var _bridgeListeners = [
        // Pre-register audio state listeners so they survive page navigation
        { className: 'nm.play', event: 'playerStateChanged', objectId: '' },
        { className: 'nm.play', event: 'songChanged2', objectId: '' },
        { className: 'nm.play', event: 'playEnd', objectId: '' },
        { className: 'nm.play', event: 'stateChange', objectId: '' },
      ];

      function normalizeMusicUrls(value) {
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) {
          for (var i = 0; i < value.length; i++) normalizeMusicUrls(value[i]);
          return value;
        }
        Object.keys(value).forEach(function(key) {
          var item = value[key];
          if (typeof item === 'string' && item.indexOf('http://') === 0 && /\\.music\\.126\\.net\\//.test(item)) {
            value[key] = item.replace('http://', 'https://');
          } else if (item && typeof item === 'object') {
            normalizeMusicUrls(item);
          }
        });
        return value;
      }

      function getAudioCurrentTime() {
        if (!_audioState.playing) return _audioState.currentTime || 0;
        return Math.min(_audioState.duration, Math.floor((Date.now() - _audioState.startAt) / 1000));
      }

      function fireNativeEvent(className, eventName, data, objectId) {
        if (!window.MNBCallback) {
          console.warn('[BridgeMock] fireNativeEvent: MNBCallback not available');
          return;
        }
        var payload = data || {};
        try {
          console.log('[BridgeMock] fireNativeEvent:', className, eventName, JSON.stringify(payload).substring(0, 120));
          // SDK checks !seq for event dispatch — -1 is truthy so events were ignored! Use 0.
          window.MNBCallback(0, null, payload, { event: eventName, class: className || '', objectId: objectId || '' });
        } catch (evtErr) {
          console.warn('[BridgeMock] native event failed:', className, eventName, evtErr.message);
        }
      }

      function fireAudioEvent(eventName, data) {
        var payload = data || {};
        console.log('[BridgeMock] fireAudioEvent:', eventName, 'listeners:', _bridgeListeners.length);
        // Alias mapping for H5 page compatibility
        var aliases = [];
        if (eventName === 'stateChange') aliases.push('playerStateChanged');
        if (eventName === 'playerStateChanged') aliases.push('stateChange');
        if (eventName === 'songChanged') aliases.push('songChanged2');
        if (eventName === 'songChanged2') aliases.push('songChanged');
        // Collect all (className, event) pairs to fire, deduplicating
        var toFire = {};
        function addFire(cls, evt, objId) {
          var key = cls + '|' + evt;
          if (!toFire[key]) toFire[key] = { className: cls, event: evt, objectId: objId || '' };
        }
        // From explicit class targets
        addFire('html.audio', eventName);
        addFire('nm.play', eventName);
        for (var i = 0; i < aliases.length; i++) {
          addFire('nm.play', aliases[i]);
        }
        // From registered listeners
        for (var i = 0; i < _bridgeListeners.length; i++) {
          var listener = _bridgeListeners[i];
          if (!listener || !listener.event) continue;
          if (listener.event === eventName || listener.event === 'audio.' + eventName || listener.event === 'html.audio.' + eventName) {
            addFire(listener.className, listener.event, listener.objectId);
          }
          for (var a = 0; a < aliases.length; a++) {
            if (listener.event === aliases[a]) {
              addFire(listener.className, listener.event, listener.objectId);
            }
          }
        }
        // Fire all deduplicated events
        var keys = Object.keys(toFire);
        for (var k = 0; k < keys.length; k++) {
          var entry = toFire[keys[k]];
          fireNativeEvent(entry.className, entry.event, payload, entry.objectId);
        }
      }

      function scheduleAudioEnd() {
        if (_audioState.timer) clearTimeout(_audioState.timer);
        _audioState.timer = setTimeout(function() {
          _audioState.playing = false;
          _audioState.currentTime = Math.max(16, getAudioCurrentTime());
          if (_audioState.progressTimer) clearInterval(_audioState.progressTimer);
          fireAudioEvent('ended', { currentTime: _audioState.currentTime, duration: _audioState.duration });
          fireAudioEvent('playEnd', { currentTime: _audioState.currentTime, duration: _audioState.duration, playState: 3 });
          fireAudioEvent('stateChange', { currentTime: _audioState.currentTime, duration: _audioState.duration, playState: 3 });
          console.log('[BridgeMock] fired html.audio ended (16s)');
        }, 16000);
      }

      function normalizeAudioUrl(url) {
        if (typeof url === 'string' && url.indexOf('http://') === 0 && /\\.music\\.126\\.net\\//.test(url)) {
          return url.replace('http://', 'https://');
        }
        return url || '';
      }

      function setAudioSource(url) {
        var nextUrl = normalizeAudioUrl(url || '');
        if (nextUrl) {
          _audioState.src = nextUrl;
          console.log('[BridgeMock] cached audio src:', _audioState.src.substring(0, 160));
        }
        return _audioState.src;
      }

      function findAudioUrl(value) {
        if (!value || typeof value !== 'object') return '';
        if (Array.isArray(value)) {
          for (var i = 0; i < value.length; i++) {
            var foundInArray = findAudioUrl(value[i]);
            if (foundInArray) return foundInArray;
          }
          return '';
        }
        if (typeof value.url === 'string' && value.url) return value.url;
        if (typeof value.src === 'string' && value.src) return value.src;
        if (typeof value.audioUrl === 'string' && value.audioUrl) return value.audioUrl;
        if (typeof value.songUrl === 'string' && value.songUrl) return value.songUrl;
        var keys = Object.keys(value);
        for (var j = 0; j < keys.length; j++) {
          var item = value[keys[j]];
          if (item && typeof item === 'object') {
            var found = findAudioUrl(item);
            if (found) return found;
          }
        }
        return '';
      }

      function audioPayload(extra) {
        var payload = {
          src: _audioState.src,
          url: _audioState.src,
          currentTime: getAudioCurrentTime(),
          duration: _audioState.duration,
          playState: _audioState.playing ? 1 : 2,
          paused: !_audioState.playing
        };
        if (extra && typeof extra === 'object') {
          Object.keys(extra).forEach(function(key) { payload[key] = extra[key]; });
        }
        return payload;
      }

      function startAudioProgress() {
        if (_audioState.progressTimer) clearInterval(_audioState.progressTimer);
        _audioState.progressTimer = setInterval(function() {
          if (!_audioState.playing) return;
          var ct = getAudioCurrentTime();
          var payload = audioPayload({ playState: 1, progress: Math.min(1, ct / _audioState.duration), currentTime: ct });
          fireAudioEvent('timeupdate', payload);
          fireAudioEvent('progress', payload);
          fireAudioEvent('stateChange', payload);
        }, 1000);
      }

      function ensureAudioElement(src) {
        if (!_audioElement) {
          _audioElement = new Audio();
          _audioElement.preload = 'auto';
          _audioElement.autoplay = true;
          _audioElement.dataset.bridgeMock = 'true';
          _audioElement.addEventListener('ended', function() {
            _audioState.playing = false;
            _audioState.currentTime = Math.max(16, getAudioCurrentTime());
            if (_audioState.progressTimer) clearInterval(_audioState.progressTimer);
            fireAudioEvent('ended', { currentTime: _audioState.currentTime, duration: _audioState.duration });
            fireAudioEvent('playEnd', { currentTime: _audioState.currentTime, duration: _audioState.duration, playState: 3 });
            fireAudioEvent('stateChange', { currentTime: _audioState.currentTime, duration: _audioState.duration, playState: 3 });
          });
        }
        if (src && _audioElement.src !== src) {
          _audioElement.src = src;
        }
        return _audioElement;
      }

      var _origPrompt = window.prompt;
      window.prompt = function(msg, defaultVal) {
        if (typeof msg !== 'string' || msg.charAt(0) !== '{') {
          return _origPrompt ? _origPrompt.call(window, msg, defaultVal) : defaultVal;
        }

        try {
          var req = JSON.parse(msg);
          var method = req.method || '';
          var params = req.params || {};
          var seq = req.seq;

          var result = { code: 200, context: {} };
          var handledAsync = false;

          if (method === 'page.didAppear' || method === 'page.didDisappear') {
            result.context = {};
          }
          else if (method === 'page.info') {
            result.context = { statusBarHeight: 24, navBarHeight: 48 };
          }
          else if (method === 'page.setUI' || method === 'page.setGestureBackEnable'
                || method === 'page.setTitle' || method === 'page.setTopButton') {
            result.context = {};
          }
          else if (method === 'user.isLogin') {
            result.context = { code: 200, data: { isLogin: true } };
          }
          else if (method === 'user.baseinfo') {
            result.context = {
              code: 200,
              data: {
                status: 'NORMAL',
                dismissed: false,
                nickname: '${nickname}',
                userId: '${userId}',
                isPartner: true,
                partnerStatus: 'NORMAL',
              },
              nextPeriodStart: Date.now() + 86400000
            };
          }
          else if (method === 'navigator.pop') {
            if (window.history.length > 1) {
              window.history.back();
            }
            result.context = {};
          }
          else if (method === 'navigator.openURL') {
            var navUrl = params.url;
            console.log('[BridgeMock] navigator.openURL:', navUrl);
            if (navUrl) {
              if (navUrl.indexOf('mp.music.163.com') !== -1 || navUrl.indexOf('music.163.com') !== -1) {
                window.location.href = navUrl;
              } else {
                try { require('electron').shell.openExternal(navUrl); } catch(e) {}
              }
            }
            result.context = {};
          }
          else if (method === 'guardian.getToken') {
            result.context = { code: 200, data: { token: '', expireTime: Date.now() + 86400000 * 30 } };
          }
          else if (method === 'log.logLocal' || method === 'log.add'
                || method === 'eventTracing.refers' || method === 'eventTracing.reportBatch') {
            if (method === 'eventTracing.refers') {
              result.context = { code: 200, data: { refers: { eventrefer: '', multirefers: '[]' } }, refers: { eventrefer: '', multirefers: '[]' } };
            } else {
              result.context = { code: 200, data: {} };
            }
          }
          else if (method === 'net.nativeRequest' || method === 'net.nefetch') {
            var reqPath = params.path || params.url || params.uri || '';
            var reqMethod = (params.method || params.type || 'GET').toUpperCase();
            var reqData = params.data || params.body || params.params || null;
            var isEncrypt = !!(params.isEncrypt || params.encrypt || params.eapi || params.crypto);

            if (!reqPath) {
              console.log('[BridgeMock] ' + method + ': available() test');
              result.code = 200;
              result.context = { status: 200, code: 200, body: { code: 200 }, data: { code: 200 }, header: {}, headers: {}, profile: {} };
            } else {
              var baseUrl = 'https://music.163.com';
              var reqUrl = reqPath.startsWith('http') ? reqPath : baseUrl + reqPath;
              var pathForProxy = reqPath;
              try {
                pathForProxy = reqPath.startsWith('http') ? new URL(reqPath).pathname : reqPath.split('?')[0];
              } catch (urlErr) {}
              var csrfToken = (document.cookie.match(/__csrf=([^;]+)/) || [])[1] || '';
              if (csrfToken) {
                reqUrl += (reqUrl.includes('?') ? '&' : '?') + 'csrf_token=' + csrfToken;
              }
              console.log('[BridgeMock] ' + method + ':', reqMethod, pathForProxy, 'encrypt:', isEncrypt, 'data:', JSON.stringify(reqData).substring(0, 200));

              try {
                if (!_electron && _origPrompt) {
                  return _origPrompt.call(window, msg, defaultVal);
                }
                if (!_electron) throw new Error('electron not available');
                handledAsync = true;
                result.context = { status: 102, code: 102, body: { code: 102 }, data: { code: 102 }, header: {}, headers: {}, profile: {} };
                _electron.ipcRenderer.invoke('proxy-request', {
                  url: reqUrl,
                  path: pathForProxy,
                  method: reqMethod,
                  data: reqData,
                  isEncrypt: isEncrypt,
                  csrfToken: csrfToken,
                  nativeMethod: method,
                }).then(function(proxyResult) {
                  var asyncContext;
                  if (proxyResult.error) {
                    console.error('[BridgeMock] proxy error:', proxyResult.error);
                    asyncContext = { status: -1, code: -1, body: { code: -1, message: proxyResult.error }, data: { code: -1, message: proxyResult.error }, header: {}, headers: {}, profile: {} };
                  } else {
                  console.log('[BridgeMock] ' + method + ' status:', proxyResult.status, pathForProxy);
                  var respData = normalizeMusicUrls(proxyResult.data);
                  if (pathForProxy.indexOf('/song/enhance/player/url') !== -1) {
                    setAudioSource(findAudioUrl(respData));
                  }

                  // 屏蔽推荐任务：把 recResources 全部标记为不可互动
                  if (respData && respData.data && Array.isArray(respData.data.recResources)) {
                    respData.data.recResources = respData.data.recResources.map(function(r) {
                      return Object.assign({}, r, { canInteract: false });
                    });
                  }

                  // 屏蔽推荐任务互动上报（发动态、发评论、收藏歌单）
                  if (pathForProxy.indexOf('/resource/interact/report') !== -1 && reqData) {
                    var _itype = reqData.interactType || reqData.interacttype || '';
                    if (_itype === 'PUBLISH_EVENT' || _itype === 'PUBLISH_COMMENT' || _itype === 'COLLECT_PLAYLIST') {
                      console.log('[BridgeMock] blocked rec task interact:', _itype);
                      respData = { code: 200, data: { interactResult: true } };
                    }
                  }

                  // Log non-200 API codes for diagnosis.
                  if (respData && typeof respData === 'object' && respData.code && respData.code !== 200) {
                    console.warn('[BridgeMock] API responded with code:', respData.code, reqPath, respData.message || '');
                  }
                  console.log('[BridgeMock] response body:', JSON.stringify(respData).substring(0, 200));
                    asyncContext = { status: proxyResult.status, code: proxyResult.status, body: respData || {}, data: respData || {}, header: proxyResult.headers || {}, headers: proxyResult.headers || {}, profile: {} };
                  }
                  if (window.MNBCallback && seq !== undefined) {
                    window.MNBCallback(seq, null, asyncContext, null);
                  }
                }).catch(function(proxyErr) {
                  console.error('[BridgeMock] proxy request failed:', proxyErr.message);
                  if (window.MNBCallback && seq !== undefined) {
                    window.MNBCallback(seq, null, { status: -1, code: -1, body: { code: -1, message: proxyErr.message }, data: { code: -1, message: proxyErr.message }, header: {}, headers: {}, profile: {} }, null);
                  }
                });
              } catch (proxyErr) {
                console.error('[BridgeMock] proxy request failed:', proxyErr.message);
                result.context = { status: -1, code: -1, body: { code: -1, message: proxyErr.message }, data: { code: -1, message: proxyErr.message }, header: {}, headers: {}, profile: {} };
              }
            }
          }
          // 播放器相关 — H5 播放器控制，返回有效响应让状态机推进
          // playHtmlAudio — mission page calls this when in NEM app
          // The page has its own <audio> element (Lt.tracks.song.audioNode) that drives the UI.
          // We must play THAT element so its events update the UI.
          else if (method === 'playHtmlAudio' || method === 'audio.playHtmlAudio') {
            var trackId = params.id || params.trackId || params.songId || '';
            console.log('[BridgeMock] playHtmlAudio called, trackId:', trackId, 'cached src:', _audioState.src ? _audioState.src.substring(0, 80) : 'NONE');
            _audioState.playing = true;
            _audioState.startAt = Date.now();
            _audioState.currentTime = 0;
            // Find the page's <audio> element and play it (skip bridge's own element)
            try {
              var audioElements = document.querySelectorAll('audio');
              console.log('[BridgeMock] playHtmlAudio: found', audioElements.length, 'audio elements');
              var played = false;
              for (var ai = 0; ai < audioElements.length; ai++) {
                var el = audioElements[ai];
                if (el.dataset && el.dataset.bridgeMock) continue; // skip bridge's own element
                var elSrc = el.src || el.currentSrc || '';
                console.log('[BridgeMock] audio[' + ai + '] src:', elSrc.substring(0, 80), 'paused:', el.paused);
                // Set src from cached URL if the element doesn't have one
                if (!elSrc && _audioState.src) {
                  el.src = _audioState.src;
                  console.log('[BridgeMock] set audio element src from cache');
                }
                if (el.paused) {
                  var p = el.play();
                  if (p && p.catch) p.catch(function(e) { console.warn('[BridgeMock] playHtmlAudio play() failed:', e.message); });
                  played = true;
                }
              }
              // If no page <audio> elements found, create one as fallback
              if (!played && _audioState.src) {
                console.log('[BridgeMock] no page audio elements found, creating fallback');
                var audio = ensureAudioElement(_audioState.src);
                var playPromise = audio.play();
                if (playPromise && playPromise.catch) {
                  playPromise.catch(function(playErr) {
                    console.warn('[BridgeMock] playHtmlAudio fallback audio failed:', playErr.message);
                  });
                }
              }
            } catch (domErr) {
              console.warn('[BridgeMock] playHtmlAudio DOM error:', domErr.message);
            }
            fireAudioEvent('play', { currentTime: 0, duration: _audioState.duration, playState: 1 });
            fireAudioEvent('stateChange', { currentTime: 0, duration: _audioState.duration, playState: 1 });
            startAudioProgress();
            scheduleAudioEnd();
            result.context = { code: 200, data: { playState: 1 } };
          }
          else if (method === 'nm.play.init') {
            result.context = { code: 200, data: {} };
          }
          else if (method === 'nm.play.setPlaylist') {
            var playlist = params.playlist || params.tracks || params.list || params.data || [];
            if (Array.isArray(playlist) && playlist.length > 0) {
              var track = playlist[0];
              var trackUrl = track.url || track.audioUrl || track.songUrl || track.src || '';
              if (!trackUrl) trackUrl = findAudioUrl(track);
              if (trackUrl) {
                setAudioSource(trackUrl);
                _audioState.duration = track.duration ? Math.floor(track.duration / 1000) : 180;
                console.log('[BridgeMock] nm.play.setPlaylist cached:', _audioState.src.substring(0, 120));
              }
            }
            result.context = { code: 200, data: {} };
          }
          else if (method === 'nm.play.start' || method === 'nm.play.play') {
            var playSrc = params.src || params.url || params.audioUrl || findAudioUrl(params) || _audioState.src;
            if (playSrc) setAudioSource(playSrc);
            _audioState.playing = true;
            _audioState.startAt = Date.now() - ((_audioState.currentTime || 0) * 1000);
            console.log('[BridgeMock] nm.play.start src:', _audioState.src.substring(0, 120));
            // Play the page's <audio> element
            try {
              var audioElements = document.querySelectorAll('audio');
              var playedPageAudio = false;
              for (var ai = 0; ai < audioElements.length; ai++) {
                var el = audioElements[ai];
                if (el.dataset && el.dataset.bridgeMock) continue;
                var elSrc = el.src || el.currentSrc || '';
                if (!elSrc && _audioState.src) el.src = _audioState.src;
                if (el.paused) {
                  var p = el.play();
                  if (p && p.catch) p.catch(function(e) {});
                  playedPageAudio = true;
                }
              }
              if (!playedPageAudio && _audioState.src) {
                var audio = ensureAudioElement(_audioState.src);
                var playPromise = audio.play();
                if (playPromise && playPromise.catch) {
                  playPromise.catch(function(playErr) {
                    console.warn('[BridgeMock] nm.play audio failed:', playErr.message);
                  });
                }
              }
            } catch (audioErr) {
              console.warn('[BridgeMock] nm.play audio unavailable:', audioErr.message);
            }
            fireAudioEvent('stateChange', { playState: 1, currentTime: 0, duration: _audioState.duration });
            startAudioProgress();
            scheduleAudioEnd();
            result.context = { code: 200, data: { playState: 1 } };
          }
          else if (method === 'nm.play.pause') {
            _audioState.currentTime = getAudioCurrentTime();
            _audioState.playing = false;
            if (_audioState.timer) clearTimeout(_audioState.timer);
            if (_audioState.progressTimer) clearInterval(_audioState.progressTimer);
            if (_audioElement) _audioElement.pause();
            fireAudioEvent('stateChange', { playState: 2, currentTime: _audioState.currentTime, duration: _audioState.duration });
            result.context = { code: 200, data: { playState: 2 } };
          }
          else if (method === 'nm.play.getPlayState') {
            var st = _audioState.playing ? 1 : (_audioState.currentTime > 0 ? 2 : 0);
            result.context = { code: 200, data: { playState: st, progress: _audioState.duration ? getAudioCurrentTime() / _audioState.duration : 0 } };
          }
          else if (method === 'nm.play.getProgress') {
            result.context = { code: 200, data: { progress: getAudioCurrentTime(), duration: _audioState.duration } };
          }
          else if (method === 'nm.play.seekTo') {
            _audioState.currentTime = Number(params.currentTime || params.position || params.time || 0) || 0;
            _audioState.startAt = Date.now() - (_audioState.currentTime * 1000);
            if (_audioElement) _audioElement.currentTime = _audioState.currentTime;
            result.context = { code: 200, data: {} };
          }
          else if (method === 'nm.play.stop') {
            _audioState.playing = false;
            _audioState.currentTime = 0;
            if (_audioState.timer) clearTimeout(_audioState.timer);
            if (_audioState.progressTimer) clearInterval(_audioState.progressTimer);
            if (_audioElement) { _audioElement.pause(); _audioElement.currentTime = 0; }
            result.context = { code: 200, data: {} };
          }
          else if (method === 'nm.play._addEventListener') {
            result.context = { code: 200 };
            var evtName = params.event || '';
            var listenerClass = params.class || params.className || 'nm.play';
            var listenerObjectId = params.objectId || '';

            // Register in _bridgeListeners so fireAudioEvent can dispatch
            _bridgeListeners.push({ className: listenerClass, event: evtName, objectId: listenerObjectId });
            console.log('[BridgeMock] nm.play addEventListener:', evtName);

            // Map known aliases: playerStateChanged -> stateChange, songChanged2 -> songChanged
            var isStateEvent = (evtName === 'stateChange' || evtName === 'playerStateChanged');
            var isPlayEndEvent = (evtName === 'playEnd');
            var isSongEvent = (evtName === 'songChanged' || evtName === 'songChanged2');

            if (isStateEvent) {
              // Immediately fire "playing", then "ended" after 16s
              // fireAudioEvent('stateChange') auto-fires 'playerStateChanged' via alias
              setTimeout(function() {
                fireAudioEvent('stateChange', { playState: 1, progress: 0, currentTime: 0, duration: _audioState.duration });
                console.log('[BridgeMock] fired playerStateChanged playing');
              }, 500);
              setTimeout(function() {
                fireAudioEvent('stateChange', { playState: 3, progress: 1.0, currentTime: _audioState.duration, duration: _audioState.duration });
                console.log('[BridgeMock] fired playerStateChanged ended (16s)');
              }, 16000);
            } else if (isPlayEndEvent) {
              setTimeout(function() {
                fireAudioEvent('playEnd', { playState: 3, progress: 1.0 });
                console.log('[BridgeMock] fired playEnd (16s)');
              }, 16000);
            } else if (isSongEvent) {
              // fireAudioEvent('songChanged') auto-fires 'songChanged2' via alias
              setTimeout(function() {
                fireAudioEvent('songChanged', { src: _audioState.src });
                console.log('[BridgeMock] fired songChanged2');
              }, 300);
            }
          }
          else if (method === 'nm.play._removeEventListener') {
            var removeEvt = params.event || '';
            var removeObjId = params.objectId || '';
            _bridgeListeners = _bridgeListeners.filter(function(l) {
              return !(l.className === 'nm.play' && l.event === removeEvt && l.objectId === removeObjId);
            });
            result.context = { code: 200 };
          }
          else if (method === 'nm.play.getLyric' || method === 'nm.play.getSong') {
            result.context = { code: 200, data: {} };
          }
          else if (method === 'html.audio.setSrc' || method === 'html.audio.setUrl'
                || method === 'html.audio.load' || method === 'html.audio.create') {
            var loadedSrc = setAudioSource(params.src || params.url || params.audioUrl || params.audio || params.songUrl || findAudioUrl(params));
            if (loadedSrc) ensureAudioElement(loadedSrc);
            result.context = { code: 200, data: audioPayload({ playState: _audioState.playing ? 1 : 0, paused: !_audioState.playing }) };
          }
          else if (method === 'html.audio.play' || method === 'html.audio.resume') {
            setAudioSource(params.src || params.url || params.audioUrl || params.audio || params.songUrl || findAudioUrl(params) || _audioState.src || '');
            _audioState.playing = true;
            _audioState.startAt = Date.now() - ((_audioState.currentTime || 0) * 1000);
            console.log('[BridgeMock] html.audio.play src:', _audioState.src.substring(0, 160));
            // Play the page's <audio> element so its events drive the UI
            try {
              var audioElements = document.querySelectorAll('audio');
              var playedPageAudio = false;
              for (var ai = 0; ai < audioElements.length; ai++) {
                var el = audioElements[ai];
                if (el.dataset && el.dataset.bridgeMock) continue; // skip bridge's own element
                var elSrc = el.src || el.currentSrc || '';
                if (!elSrc && _audioState.src) {
                  el.src = _audioState.src;
                }
                if (el.paused) {
                  var p = el.play();
                  if (p && p.catch) p.catch(function(e) { console.warn('[BridgeMock] html.audio.play page audio failed:', e.message); });
                  playedPageAudio = true;
                }
              }
              if (!playedPageAudio && _audioState.src) {
                var audio = ensureAudioElement(_audioState.src);
                var playPromise = audio.play();
                if (playPromise && playPromise.catch) {
                  playPromise.catch(function(playErr) {
                    console.warn('[BridgeMock] real audio play failed:', playErr.message);
                  });
                }
              }
            } catch (audioErr) {
              console.warn('[BridgeMock] real audio unavailable:', audioErr.message);
            }
            try {
              console.log('[BridgeMock] about to fire play/stateChange events');
              fireAudioEvent('play', { currentTime: getAudioCurrentTime(), duration: _audioState.duration, playState: 1 });
              fireAudioEvent('stateChange', { currentTime: getAudioCurrentTime(), duration: _audioState.duration, playState: 1 });
              console.log('[BridgeMock] events fired, starting progress timer');
              startAudioProgress();
              scheduleAudioEnd();
            } catch (evtErr) {
              console.error('[BridgeMock] event firing error:', evtErr.message, evtErr.stack);
            }
            result.context = { code: 200, data: audioPayload({ playState: 1, paused: false }) };
          }
          else if (method === 'html.audio.pause') {
            _audioState.currentTime = getAudioCurrentTime();
            _audioState.playing = false;
            if (_audioState.timer) clearTimeout(_audioState.timer);
            if (_audioState.progressTimer) clearInterval(_audioState.progressTimer);
            if (_audioElement) _audioElement.pause();
            fireAudioEvent('pause', { currentTime: _audioState.currentTime, duration: _audioState.duration, playState: 2 });
            result.context = { code: 200, data: audioPayload({ playState: 2, paused: true }) };
          }
          else if (method === 'html.audio.stop' || method === 'html.audio.destroy') {
            _audioState.playing = false;
            _audioState.currentTime = 0;
            if (_audioState.timer) clearTimeout(_audioState.timer);
            if (_audioState.progressTimer) clearInterval(_audioState.progressTimer);
            if (_audioElement) {
              _audioElement.pause();
              _audioElement.currentTime = 0;
            }
            result.context = { code: 200, data: audioPayload({ currentTime: 0, playState: 0, paused: true }) };
          }
          else if (method === 'html.audio.seek') {
            _audioState.currentTime = Number(params.currentTime || params.position || params.time || 0) || 0;
            _audioState.startAt = Date.now() - (_audioState.currentTime * 1000);
            if (_audioElement) _audioElement.currentTime = _audioState.currentTime;
            result.context = { code: 200, data: audioPayload() };
          }
          else if (method === 'html.audio.getState' || method === 'html.audio.getStatus' || method === 'html.audio.currentTime') {
            result.context = { code: 200, data: audioPayload() };
          }
          else if (method === 'html.audio.addEventListener' || method === 'html.audio.removeEventListener') {
            result.context = { code: 200, data: {} };
          }
          else if (method === '_addEventListener') {
            var listenerClass = req.class || req.className || params.class || params.className || '';
            var listenerEvent = req.event || params.event || params.name || params.type || '';
            var listenerObjectId = req.objectId || params.objectId || '';
            if (listenerEvent) {
              _bridgeListeners.push({ className: listenerClass, event: listenerEvent, objectId: listenerObjectId });
              console.log('[BridgeMock] add listener:', listenerClass || '-', listenerEvent, listenerObjectId || '-');
              if (listenerEvent === 'stateChange' || listenerEvent === 'play' || listenerEvent === 'playing') {
                setTimeout(function() {
                  fireNativeEvent(listenerClass, listenerEvent, audioPayload({ playState: _audioState.playing ? 1 : 0 }), listenerObjectId);
                }, 200);
              }
            }
            result.context = { code: 200, data: {} };
          }
          else if (method === '_removeEventListener') {
            var removeClass = req.class || req.className || params.class || params.className || '';
            var removeEvent = req.event || params.event || params.name || params.type || '';
            var removeObjectId = req.objectId || params.objectId || '';
            _bridgeListeners = _bridgeListeners.filter(function(listener) {
              return !(listener.className === removeClass && listener.event === removeEvent && listener.objectId === removeObjectId);
            });
            result.context = { code: 200, data: {} };
          }
          else if (method.indexOf('toast') === 0 || method.indexOf('font') === 0
                || method.indexOf('mp.') === 0) {
            result.context = {};
          }
          // 通用 nm.* 未知方法兜底
          else if (method.indexOf('nm.') === 0) {
            console.log('[BridgeMock] nm.* unhandled:', method, JSON.stringify(params).substring(0, 100));
            result.context = { code: 200, data: {} };
          }
          else {
            console.log('[BridgeMock] unhandled:', method);
            result.context = {};
          }

          var response = JSON.stringify(result);

          // MNBCallback 期望 4 个独立参数 (seq, error, result, options)
          if (!handledAsync && window.MNBCallback && seq !== undefined) {
            console.log('[BridgeMock] calling MNBCallback seq:', seq, 'method:', method);
            (function(seqNum, err, res) {
              setTimeout(function() {
                try {
                  window.MNBCallback(seqNum, err, res, null);
                } catch(cbErr) {
                  console.error('[BridgeMock] MNBCallback error:', cbErr.message);
                }
              }, 0);
            })(seq, null, result.context);
          } else if (!window.MNBCallback) {
            console.log('[BridgeMock] MNBCallback not ready yet for method:', method);
          }

          return response;
        } catch (e) {
          console.error('[BridgeMock] parse error:', e.message);
          return JSON.stringify({ code: 200, context: {} });
        }
      };

      if (!window.webkit) window.webkit = {};
      if (!window.webkit.messageHandlers) window.webkit.messageHandlers = {};

      window.MNBDidBuild = true;
      if (window.MNBCallback) {
        window.MNBCallback(JSON.stringify({ code: 200, context: { ready: true } }));
      }

      console.log('[BridgeMock] injected OK, electron available:', !!_electron);
    })();
  `

}

module.exports = { createMusicPartnerBridgeScript }
