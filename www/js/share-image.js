(function (global) {
  // Shared by End Day and Chi Phí Thành Viên Cố Định: renders a popup to PNG and shares it,
  // followed by the bank payment QR, through Android's native chooser (Zalo, Messenger, ...).

  function nativeShare() {
    var cap = global.Capacitor;
    return cap && cap.Plugins && cap.Plugins.Share ? cap.Plugins.Share : null;
  }

  // The user closing the chooser without picking an app isn't an error worth reporting.
  function reportShareError(err) {
    var message = err && err.message ? err.message : String(err || '');
    if (/cancel/i.test(message)) {
      return;
    }
    alert('Không chia sẻ được: ' + (message || 'lỗi không xác định'));
  }

  // Titles are free text (days can be renamed), so strip accents and anything that isn't safe
  // in a file name — a "/" would otherwise point at a missing sub-folder and make the cache
  // write fail.
  function toSafeFileName(title, suffix) {
    var base = (title || 'ket-ngay')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (base || 'ket-ngay') + (suffix || '') + '.png';
  }

  function shareText(title, text) {
    var share = nativeShare();
    if (share) {
      share.share({ title: title, text: text, dialogTitle: 'Chia sẻ' }).catch(reportShareError);
    } else if (navigator.share) {
      navigator.share({ title: title, text: text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        alert('Copied to clipboard!');
      });
    } else {
      alert(text);
    }
  }

  function downloadImage(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        resolve(String(reader.result).split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // The payment QR is a static bundled asset — fetched and materialized only once per page
  // load, then reused for every share click.
  var qrFileUriPromise = null;
  function getQrFileUri() {
    if (!qrFileUriPromise) {
      qrFileUriPromise = fetch('img/payment-qr.jpg')
        .then(function (res) {
          return res.blob();
        })
        .then(blobToBase64)
        .then(function (base64) {
          return global.Capacitor.Plugins.Filesystem.writeFile({
            path: 'payment-qr.jpg',
            data: base64,
            directory: 'CACHE'
          });
        })
        .then(function (result) {
          return result.uri;
        })
        .catch(function () {
          return null;
        });
    }
    return qrFileUriPromise;
  }

  var qrFilePromise = null;
  function getQrFile() {
    if (!qrFilePromise) {
      qrFilePromise = fetch('img/payment-qr.jpg')
        .then(function (res) {
          return res.blob();
        })
        .then(function (blob) {
          return new File([blob], 'payment-qr.jpg', { type: 'image/jpeg' });
        })
        .catch(function () {
          return null;
        });
    }
    return qrFilePromise;
  }

  /** Warms the QR cache ahead of a share when running in the packaged app. */
  function prefetchQr() {
    var cap = global.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.Filesystem) {
      getQrFileUri();
    }
  }

  // Shares the images ({ blob, fileName }) through Android's native chooser (Zalo, Messenger,
  // etc.) when running inside the packaged app, followed by the payment QR code. Plain
  // navigator.share/canShare generally isn't implemented in an embedded Android WebView the
  // way it is in the Chrome browser, so that's only used as a fallback for non-packaged
  // (plain browser) testing. Calls onReady() just before the chooser opens (or on failure).
  function shareImages(images, title, onReady) {
    var cap = global.Capacitor;

    if (cap && cap.Plugins && cap.Plugins.Share && cap.Plugins.Filesystem) {
      var writes = images.map(function (image) {
        return blobToBase64(image.blob).then(function (base64) {
          return cap.Plugins.Filesystem.writeFile({
            path: image.fileName,
            data: base64,
            directory: 'CACHE'
          });
        }).then(function (result) {
          return result.uri;
        });
      });
      return Promise.all(writes.concat([getQrFileUri()]))
        .then(function (uris) {
          var files = uris.filter(function (u) {
            return !!u;
          });
          onReady();
          return cap.Plugins.Share.share({
            title: title,
            files: files,
            dialogTitle: 'Chia sẻ'
          });
        })
        .catch(function (err) {
          onReady();
          reportShareError(err);
        });
    }

    var screenshotFiles = images.map(function (image) {
      return new File([image.blob], image.fileName, { type: 'image/png' });
    });
    return getQrFile().then(function (qrFile) {
      onReady();
      var files = qrFile ? screenshotFiles.concat([qrFile]) : screenshotFiles;

      function downloadAll() {
        images.forEach(function (image) {
          downloadImage(image.blob, image.fileName);
        });
        if (qrFile) {
          downloadImage(qrFile, 'payment-qr.jpg');
        }
        alert('Đã tải ảnh xuống. Hãy đính kèm ảnh vào Messenger/Zalo để chia sẻ.');
      }

      function webShare() {
        return navigator.share({ files: files, title: title });
      }

      if (!(navigator.canShare && navigator.canShare({ files: files }))) {
        downloadAll();
        return;
      }

      // Browsers (Safari on iPhone especially) only open the share sheet straight after a tap,
      // and rendering the images takes longer than that allowance. When the share is refused
      // for that reason, ask for one more tap and share from inside it.
      return webShare().catch(function (err) {
        if (err && err.name === 'NotAllowedError') {
          showTapToShare(function () {
            webShare().catch(function (retryErr) {
              if (!retryErr || retryErr.name !== 'AbortError') {
                downloadAll();
              }
            });
          });
        } else if (!err || err.name !== 'AbortError') {
          downloadAll();
        }
      });
    });
  }

  function showTapToShare(onShare) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-card">' +
      '<h2>Ảnh đã sẵn sàng</h2>' +
      '<div class="modal-actions">' +
      '<button type="button" class="secondary-button" data-action="cancel">Cancel</button>' +
      '<button type="button" class="primary-button" data-action="share">Chia sẻ</button>' +
      '</div>' +
      '</div>';
    overlay.addEventListener('click', function (e) {
      var action = e.target.getAttribute('data-action');
      if (action || e.target === overlay) {
        document.body.removeChild(overlay);
      }
      if (action === 'share') {
        onShare();
      }
    });
    document.body.appendChild(overlay);
  }

  function renderToBlob(el, options) {
    return global.html2canvas(el, options).then(function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(resolve, 'image/png');
      });
    });
  }

  /**
   * Renders a popup's .modal-card at its full natural height (not the scrollable 85vh box it
   * uses on screen), with its action buttons left out of the picture.
   */
  function renderModalCard(cardEl, overlayId, actionsSelector) {
    var fullHeight = cardEl.scrollHeight;
    return renderToBlob(cardEl, {
      backgroundColor: getComputedStyle(cardEl).backgroundColor,
      // 2x is sharp enough for chat apps; the device's own ratio (often 3+) makes
      // a canvas large enough to exhaust the WebView's memory.
      scale: 2,
      height: fullHeight,
      windowHeight: Math.max(fullHeight + 100, global.innerHeight),
      onclone: function (clonedDoc, clonedEl) {
        var actions = clonedDoc.querySelector(actionsSelector);
        if (actions) {
          actions.style.display = 'none';
        }
        var overlay = clonedDoc.getElementById(overlayId);
        if (overlay) {
          overlay.style.position = 'static';
          overlay.style.display = 'block';
          overlay.style.background = 'transparent';
        }
        if (clonedEl) {
          clonedEl.style.maxHeight = 'none';
          clonedEl.style.overflowY = 'visible';
        }
      }
    });
  }

  /**
   * The "Đang chuẩn bị ảnh..." overlay shown while a share is prepared, which also disables the
   * share button. The spinner's CSS animation runs on the compositor only, so while the share
   * waits on async work (html2canvas's cloned iframe and SVG image loads, Capacitor bridge
   * replies) the Android WebView produces no main-thread frames and those callbacks stall until
   * the user touches the screen. Nudging the DOM every frame keeps the WebView rendering.
   */
  function createLoading(overlayEl, buttonEl) {
    var keepAliveFrame = null;

    function startFrameKeepAlive() {
      var tick = 0;
      function step() {
        tick++;
        overlayEl.style.opacity = tick % 2 ? '0.999' : '1';
        keepAliveFrame = requestAnimationFrame(step);
      }
      if (keepAliveFrame === null) {
        keepAliveFrame = requestAnimationFrame(step);
      }
    }

    function stopFrameKeepAlive() {
      if (keepAliveFrame !== null) {
        cancelAnimationFrame(keepAliveFrame);
        keepAliveFrame = null;
      }
      overlayEl.style.opacity = '';
    }

    return {
      show: function () {
        buttonEl.disabled = true;
        overlayEl.hidden = false;
        startFrameKeepAlive();
      },
      hide: function () {
        stopFrameKeepAlive();
        buttonEl.disabled = false;
        overlayEl.hidden = true;
      }
    };
  }

  global.ShareImage = {
    toSafeFileName: toSafeFileName,
    shareText: shareText,
    shareImages: shareImages,
    renderToBlob: renderToBlob,
    renderModalCard: renderModalCard,
    createLoading: createLoading,
    prefetchQr: prefetchQr
  };
})(window);
