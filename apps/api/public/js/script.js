/**
 * Webyz tracker.
 *
 * Configured entirely from data-* attributes on the script tag:
 *   data-site-id         required, the website UUID
 *   data-endpoint        required, e.g. https://api.example.com/api/v1/track
 *   data-domain          override the reported hostname
 *   data-auto-track      "false" to disable automatic pageviews and clicks
 *   data-track-localhost "true" to record traffic from localhost
 *   data-exclude-search  "true" to strip the query string
 *   data-exclude-hash    "true" to strip the fragment
 *   data-hash-routing    "true" for apps that route on the fragment (/#/about):
 *                        the fragment becomes part of the path and a
 *                        hashchange counts as a pageview
 *   data-outbound-links  "true" to send "Outbound Link: Click" (prop: href)
 *                        for clicks on links to other hosts
 *   data-file-downloads  "true" to send "File Download" (prop: href) for
 *                        clicks on links to files; data-file-types overrides
 *                        the extension list ("pdf,zip,...")
 *   data-track-404       "true" to send a "404" event (prop: page) when the
 *                        document carries <meta name="webyz-404">, which is
 *                        how a not-found template announces itself
 *   data-respect-dnt     "false" to ignore Do Not Track (respected by default)
 *   data-debug           "true" to log to the console
 *
 * Public API: window.webyz.event(name, props), .pageview(), .optOut(), .optIn()
 *
 * Storage: none. The tracker sets no cookies and writes nothing to the
 * browser; visitors and sessions are derived on the server from a hash that
 * rotates daily. The one exception is the opt-out flag in localStorage, which
 * exists only if the visitor calls webyz.optOut().
 */
(function (window, document) {
  "use strict";

  var config = {
    siteId: "",
    endPoint: "",
    domain: "",
    autoTrack: true,
    trackLocalhost: false,
    excludeSearch: false,
    excludeHash: false,
    hashRouting: false,
    outboundLinks: false,
    fileDownloads: false,
    fileTypes: [],
    track404: false,
    respectDNT: true,
    debug: false,
  };

  // Extensions a click counts as a download for, unless data-file-types says
  // otherwise. The names are the ones Plausible and Umami track by default,
  // so a goal set up elsewhere carries over.
  var DEFAULT_FILE_TYPES = [
    "pdf", "xlsx", "xls", "docx", "doc", "pptx", "ppt", "txt", "rtf", "csv",
    "exe", "key", "pps", "ppsx", "odt", "ods", "odp", "7z", "pkg", "rar",
    "gz", "zip", "tar", "avi", "mov", "mp4", "mpeg", "mpg", "wmv", "midi",
    "mid", "mp3", "wav", "wma", "dmg", "apk", "epub", "iso", "ipa", "svg",
    "webp", "psd",
  ];

  var state = {
    initialized: false,
    currentUrl: "",
    currentRef: "",
    // In-memory only, so a custom event can be tied to the pageview it
    // happened on. Never persisted.
    pageviewId: "",
  };

  var OPT_OUT_KEY = "webyz-disabled";
  var DNT_VALUES = ["1", 1, "yes", true];

  var utils = {
    generateId: function () {
      if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
      }
      return (
        Date.now().toString(36) + Math.random().toString(36).substring(2, 10)
      );
    },

    stringify: function (obj) {
      var params = new URLSearchParams();
      Object.keys(obj).forEach(function (key) {
        var value = obj[key];
        if (value !== null && value !== undefined && value !== "") {
          params.append(key, String(value));
        }
      });
      return params.toString();
    },

    hasDoNotTrack: function () {
      var dnt =
        navigator.doNotTrack || navigator.msDoNotTrack || window.doNotTrack;
      return DNT_VALUES.indexOf(dnt) !== -1;
    },

    isLocalhost: function () {
      return (
        /^localhost$|^127(\.[0-9]+){0,2}\.[0-9]+$|^\[::1?\]$/.test(
          location.hostname,
        ) || location.protocol === "file:"
      );
    },

    isBot: function () {
      return !!(
        window._phantom ||
        window.__nightmare ||
        window.navigator.webdriver ||
        window.Cypress ||
        /bot|crawler|spider|crawling/i.test(navigator.userAgent)
      );
    },

    isOptedOut: function () {
      try {
        return localStorage.getItem(OPT_OUT_KEY) === "true";
      } catch (e) {
        return false;
      }
    },

    shouldIgnore: function () {
      if (config.respectDNT && utils.hasDoNotTrack()) return "DNT enabled";
      if (!config.trackLocalhost && utils.isLocalhost()) return "localhost";
      if (utils.isOptedOut()) return "opted out";
      if (document.visibilityState === "prerender") return "prerendered page";
      if (utils.isBot()) return "bot detected";
      return false;
    },

    getScreen: function () {
      return screen.width + "x" + screen.height;
    },

    /**
     * Current URL and path, honouring a canonical link and the exclude options.
     * These are plain `var`s: the previous version declared them const and then
     * reassigned them in the canonical branch, which threw on every page that
     * had a canonical tag.
     */
    getPageData: function () {
      var url = location.href;
      var path = location.pathname + location.search;

      var canonical = document.querySelector('link[rel="canonical"][href]');
      if (canonical) {
        try {
          var canonicalUrl = new URL(canonical.href, location.href);
          url = canonicalUrl.href;
          path = canonicalUrl.pathname + canonicalUrl.search;
        } catch (e) {
          // keep location-derived values
        }
      }

      if (config.excludeSearch) {
        url = location.origin + location.pathname;
        path = location.pathname;
      }

      if (config.hashRouting) {
        // The fragment is the route, so it belongs in the path. Canonical
        // links rarely carry it, so it is taken from the location itself.
        url = url.split("#")[0] + location.hash;
        path = path.split("#")[0] + location.hash;
      } else if (config.excludeHash) {
        url = url.split("#")[0];
        path = path.split("#")[0];
      }

      return { url: url, path: path };
    },

    getReferrer: function () {
      var ref = document.referrer;
      if (!ref || ref.indexOf(location.origin) === 0) return "";
      return ref;
    },

    log: function () {
      if (!config.debug) return;
      var args = Array.prototype.slice.call(arguments);
      console.log.apply(console, ["[webyz]"].concat(args));
    },
  };

  var network = {
    send: function (payload) {
      if (!config.endPoint || !config.siteId) {
        utils.log("missing data-endpoint or data-site-id");
        return Promise.resolve();
      }

      var ignore = utils.shouldIgnore();
      if (ignore) {
        utils.log("ignoring request:", ignore);
        return Promise.resolve();
      }

      return network.sendFetch(payload).catch(function () {
        // Last resort for browsers that block fetch on unload.
        return network.sendImage(payload);
      });
    },

    sendFetch: function (payload) {
      if (!window.fetch) return Promise.reject(new Error("no fetch"));

      return fetch(config.endPoint, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
      }).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        utils.log("sent", payload);
      });
    },

    sendImage: function (payload) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = config.endPoint + "?" + utils.stringify(payload);
        utils.log("sent via pixel", payload);
      });
    },
  };

  /**
   * Engagement: how long the page was actually in front of the visitor, and
   * how far down they scrolled. Modelled on Plausible's engagement events.
   *
   * Time accumulates only while the tab is visible and focused, so a page
   * left open in the background adds nothing. A report is sent when the tab
   * is hidden, loses focus or is left, and before a client-side route change,
   * whenever there is something new to say: at least three seconds of
   * visible time since the last report, or a deeper scroll. The server adds
   * the time to the session, so a one-page visit that was read for two
   * minutes is no longer a 0 s visit.
   */
  var engagement = {
    listening: false,
    ignored: true,
    url: "",
    pid: "",
    runningSince: 0,
    accumulated: 0,
    maxScrollPx: 0,
    docHeight: 0,
    sentScrollPx: -1,

    start: function (url, pid) {
      engagement.ignored = false;
      engagement.url = url;
      engagement.pid = pid;
      engagement.accumulated = 0;
      engagement.sentScrollPx = -1;
      engagement.docHeight = engagement.documentHeight();
      engagement.maxScrollPx = engagement.scrollDepthPx();
      engagement.runningSince = engagement.isActive() ? Date.now() : 0;
      engagement.listen();
    },

    isActive: function () {
      return document.visibilityState === "visible" && document.hasFocus();
    },

    elapsed: function () {
      return (
        engagement.accumulated +
        (engagement.runningSince ? Date.now() - engagement.runningSince : 0)
      );
    },

    documentHeight: function () {
      var body = document.body || {};
      var el = document.documentElement || {};
      return Math.max(
        body.scrollHeight || 0, body.offsetHeight || 0, body.clientHeight || 0,
        el.scrollHeight || 0, el.offsetHeight || 0, el.clientHeight || 0
      );
    },

    scrollDepthPx: function () {
      var el = document.documentElement || {};
      var body = document.body || {};
      var viewport = window.innerHeight || el.clientHeight || 0;
      var top = window.scrollY || window.pageYOffset || el.scrollTop || body.scrollTop || 0;
      return top + viewport;
    },

    onScroll: function () {
      var px = engagement.scrollDepthPx();
      if (px > engagement.maxScrollPx) engagement.maxScrollPx = px;
      var height = engagement.documentHeight();
      if (height > engagement.docHeight) engagement.docHeight = height;
    },

    onVisibility: function () {
      if (engagement.isActive()) {
        if (!engagement.runningSince) engagement.runningSince = Date.now();
      } else {
        engagement.accumulated = engagement.elapsed();
        engagement.runningSince = 0;
        engagement.flush();
      }
    },

    flush: function () {
      if (engagement.ignored) return;
      var ms = engagement.elapsed();
      if (engagement.maxScrollPx <= engagement.sentScrollPx && ms < 3000) return;
      engagement.sentScrollPx = engagement.maxScrollPx;
      var depth = engagement.docHeight
        ? Math.min(100, Math.round((engagement.maxScrollPx / engagement.docHeight) * 100))
        : 0;
      engagement.accumulated = 0;
      engagement.runningSince = engagement.isActive() ? Date.now() : 0;
      network.send({
        t: "engagement",
        sid: config.siteId,
        pid: engagement.pid,
        url: engagement.url,
        e: Math.round(ms),
        sd: depth,
      });
    },

    listen: function () {
      if (engagement.listening) return;
      engagement.listening = true;
      document.addEventListener("visibilitychange", engagement.onVisibility);
      window.addEventListener("blur", engagement.onVisibility);
      window.addEventListener("focus", engagement.onVisibility);
      window.addEventListener("pagehide", engagement.onVisibility);
      window.addEventListener("scroll", engagement.onScroll, { passive: true });
    },
  };

  var tracker = {
    pageview: function (custom) {
      custom = custom || {};
      var pageData = utils.getPageData();

      if (state.currentUrl === pageData.url && !custom.force) {
        utils.log("duplicate pageview ignored");
        return Promise.resolve();
      }

      // Leaving a page in a single-page app: report its engagement first.
      if (engagement.listening) engagement.flush();

      state.currentUrl = pageData.url;
      state.currentRef = utils.getReferrer();
      state.pageviewId = utils.generateId();

      var payload = {
        t: "pageview",
        sid: config.siteId,
        pid: state.pageviewId,
        url: pageData.url,
        path: pageData.path,
        ref: state.currentRef,
        title: document.title,
        lang: navigator.language,
        screen: utils.getScreen(),
      };

      Object.keys(custom).forEach(function (k) {
        if (k !== "force") payload[k] = custom[k];
      });

      engagement.start(payload.url, state.pageviewId);
      return network.send(payload);
    },

    event: function (name, props) {
      if (!name || typeof name !== "string") {
        utils.log("event name is required");
        return Promise.resolve();
      }

      var payload = {
        t: "event",
        sid: config.siteId,
        pid: state.pageviewId,
        name: name,
        url: state.currentUrl || utils.getPageData().url,
      };

      props = props || {};
      Object.keys(props).forEach(function (k) {
        payload[k] = props[k];
      });

      return network.send(payload);
    },
  };

  var autotrack = {
    init: function () {
      if (!config.autoTrack) return;
      autotrack.setupPageviews();
      document.addEventListener("click", autotrack.handleClick, true);
      if (config.outboundLinks || config.fileDownloads) {
        // Bubble phase, not capture: a page that cancels a click itself (a
        // consent modal, a licence gate) must win, and defaultPrevented is
        // only meaningful once the page's handlers have run.
        document.addEventListener("click", autotrack.handleLinkClick);
        document.addEventListener("auxclick", autotrack.handleLinkClick);
      }
    },

    setupPageviews: function () {
      var first = function () {
        tracker.pageview();
        autotrack.track404();
      };
      if (document.readyState === "complete") {
        first();
      } else {
        window.addEventListener("load", first);
      }
      autotrack.hookHistory();
    },

    hookHistory: function () {
      var pushState = history.pushState;
      var replaceState = history.replaceState;

      history.pushState = function () {
        pushState.apply(this, arguments);
        setTimeout(function () {
          tracker.pageview();
        }, 100);
      };

      history.replaceState = function () {
        replaceState.apply(this, arguments);
        setTimeout(function () {
          tracker.pageview();
        }, 100);
      };

      window.addEventListener("popstate", function () {
        setTimeout(function () {
          tracker.pageview();
        }, 100);
      });

      if (config.hashRouting) {
        window.addEventListener("hashchange", function () {
          tracker.pageview();
        });
      }
    },

    /**
     * A not-found template cannot tell the script its HTTP status, so it
     * announces itself with <meta name="webyz-404">. The event carries the
     * path as a property because the event's own URL is what the dashboard
     * groups on and a 404 goal wants the missing page listed per value.
     */
    track404: function () {
      if (!config.track404) return;
      if (!document.querySelector('meta[name="webyz-404"]')) return;
      tracker.event("404", { page: location.pathname });
    },

    /** Which auto event, if any, a click on this link produces. */
    classifyLink: function (element) {
      var href = element.href;
      if (!href || /^(mailto|tel|javascript|sms):/i.test(href)) return null;

      var target;
      try {
        target = new URL(href, location.href);
      } catch (e) {
        return null;
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return null;
      }

      if (config.fileDownloads) {
        var match = /\.([a-z0-9]+)$/i.exec(target.pathname);
        if (match && config.fileTypes.indexOf(match[1].toLowerCase()) !== -1) {
          return { name: "File Download", props: { href: target.href } };
        }
      }

      if (config.outboundLinks && target.hostname !== location.hostname) {
        return { name: "Outbound Link: Click", props: { href: target.href } };
      }

      return null;
    },

    /**
     * Outbound links and file downloads. Middle clicks arrive as auxclick, so
     * both listeners route here; a link already carrying data-analytics-event
     * is left to handleClick so one click never sends two events.
     */
    handleLinkClick: function (event) {
      if (event.type === "auxclick" && event.button !== 1) return;

      var element =
        event.target && event.target.closest && event.target.closest("a[href]");
      if (!element) return;
      if (element.closest("[data-analytics-event]")) return;

      var auto = autotrack.classifyLink(element);
      if (!auto) return;
      // The page cancelled the navigation; count nothing the visitor did not do.
      if (event.defaultPrevented) return;

      var opensElsewhere =
        element.target === "_blank" ||
        element.hasAttribute("download") ||
        event.type === "auxclick" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey;

      if (!opensElsewhere) {
        // Same trick as handleClick: hold navigation until the beacon is out.
        event.preventDefault();
        var href = element.href;
        tracker.event(auto.name, auto.props).then(function () {
          location.href = href;
        });
        return;
      }

      tracker.event(auto.name, auto.props);
    },

    /**
     * Fires for any element carrying data-analytics-event, not just links.
     * The previous version only sent the event inside the anchor branch, so the
     * attribute silently did nothing on buttons and other elements.
     */
    handleClick: function (event) {
      var element = event.target.closest("[data-analytics-event]");
      if (!element) return;

      var eventName = element.getAttribute("data-analytics-event");
      if (!eventName) return;

      var props = {};
      Array.prototype.forEach.call(element.attributes, function (attr) {
        if (attr.name.indexOf("data-analytics-") !== 0) return;
        var key = attr.name.replace("data-analytics-", "").replace(/-/g, "_");
        if (key !== "event") props[key] = attr.value;
      });

      var isAnchor = element.tagName === "A" && element.href;
      var opensElsewhere =
        element.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.button === 1;

      if (isAnchor && !opensElsewhere) {
        // Delay navigation just long enough to get the beacon out.
        event.preventDefault();
        var href = element.href;
        tracker.event(eventName, props).then(function () {
          location.href = href;
        });
        return;
      }

      tracker.event(eventName, props);
    },
  };

  var init = function () {
    if (state.initialized) return;

    var script =
      document.currentScript ||
      document.querySelector("script[data-site-id]") ||
      document.querySelector('script[src*="script.js"]');

    if (script) {
      var attr = function (name) {
        return script.getAttribute(name);
      };

      config.siteId = attr("data-site-id") || config.siteId;
      config.endPoint = attr("data-endpoint") || config.endPoint;
      config.domain = attr("data-domain") || location.hostname;
      config.autoTrack = attr("data-auto-track") !== "false";
      config.trackLocalhost = attr("data-track-localhost") === "true";
      config.excludeSearch = attr("data-exclude-search") === "true";
      config.excludeHash = attr("data-exclude-hash") === "true";
      config.hashRouting = attr("data-hash-routing") === "true";
      config.outboundLinks = attr("data-outbound-links") === "true";
      config.fileDownloads = attr("data-file-downloads") === "true";
      config.fileTypes = (attr("data-file-types") || "")
        .split(",")
        .map(function (s) {
          return s.trim().replace(/^\./, "").toLowerCase();
        })
        .filter(Boolean);
      if (!config.fileTypes.length) config.fileTypes = DEFAULT_FILE_TYPES;
      config.track404 = attr("data-track-404") === "true";
      config.respectDNT = attr("data-respect-dnt") !== "false";
      config.debug = attr("data-debug") === "true";
    }

    if (!config.siteId || !config.endPoint) {
      // Nothing useful can be reported; stay silent unless debugging.
      utils.log("tracker not configured", config);
      return;
    }

    autotrack.init();

    state.initialized = true;
    utils.log("initialized", config);
  };

  // Real public API. This object used to be empty, so webyz.event() did not
  // exist and custom events could never be sent from a page.
  window.webyz = {
    event: function (name, props) {
      return tracker.event(name, props);
    },
    pageview: function (custom) {
      return tracker.pageview(custom);
    },
    optOut: function () {
      try {
        localStorage.setItem(OPT_OUT_KEY, "true");
      } catch (e) {}
    },
    optIn: function () {
      try {
        localStorage.removeItem(OPT_OUT_KEY);
      } catch (e) {}
    },
    get config() {
      return Object.assign({}, config);
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
