// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const YOUTUBE_CONTAINER_NAME = "Youtube";
const YOUTUBE_CONTAINER_COLOR = "red";
const YOUTUBE_CONTAINER_ICON = "briefcase";
const YOUTUBE_DOMAINS = ["youtube.com", "www.youtube.com", "m.youtube.com"];

const MAC_ADDON_ID = "@testpilot-containers";

let macAddonEnabled = false;
let youtubeCookieStoreId = null;
let youtubeCookiesCleared = false;

const canceledRequests = {};
const youtubeHostREs = [];

async function isMACAddonEnabled () {
  try {
    const macAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (macAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function setupMACAddonManagementListeners () {
  browser.management.onInstalled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = true;
    }
  });
  browser.management.onUninstalled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = false;
    }
  })
  browser.management.onEnabled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = true;
    }
  })
  browser.management.onDisabled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = false;
    }
  })
}

async function getMACAssignment (url) {
  try {
    const assignment = await browser.runtime.sendMessage(MAC_ADDON_ID, {
      method: "getAssignment",
      url
    });
    return assignment;
  } catch (e) {
    return false;
  }
}

function cancelRequest (tab, options) {
  // we decided to cancel the request at this point, register canceled request
  canceledRequests[tab.id] = {
    requestIds: {
      [options.requestId]: true
    },
    urls: {
      [options.url]: true
    }
  };

  // since webRequest onCompleted and onErrorOccurred are not 100% reliable
  // we register a timer here to cleanup canceled requests, just to make sure we don't
  // end up in a situation where certain urls in a tab.id stay canceled
  setTimeout(() => {
    if (canceledRequests[tab.id]) {
      delete canceledRequests[tab.id];
    }
  }, 2000);
}

function shouldCancelEarly (tab, options) {
  // we decided to cancel the request at this point
  if (!canceledRequests[tab.id]) {
    cancelRequest(tab, options);
  } else {
    let cancelEarly = false;
    if (canceledRequests[tab.id].requestIds[options.requestId] ||
        canceledRequests[tab.id].urls[options.url]) {
      // same requestId or url from the same tab
      // this is a redirect that we have to cancel early to prevent opening two tabs
      cancelEarly = true;
    }
    // register this requestId and url as canceled too
    canceledRequests[tab.id].requestIds[options.requestId] = true;
    canceledRequests[tab.id].urls[options.url] = true;
    if (cancelEarly) {
      return true;
    }
  }
  return false;
}

function generateYoutubeHostREs () {
  for (let youtubeDomain of YOUTUBE_DOMAINS) {
    youtubeHostREs.push(new RegExp(`^(.*\\.)?${youtubeDomain}$`));
  }
}

function clearYoutubeCookies () {
  // Clear all youtube cookies
  for (let youtubeDomain of YOUTUBE_DOMAINS) {
    const youtubeCookieUrl = `https://${youtubeDomain}/`;

    browser.cookies.getAll({domain: youtubeDomain}).then(cookies => {
      for (let cookie of cookies) {
        browser.cookies.remove({name: cookie.name, url: youtubeCookieUrl});
      }
    });
  }
}

async function setupContainer () {
  // Use existing Youtube container, or create one
  const contexts = await browser.contextualIdentities.query({name: YOUTUBE_CONTAINER_NAME})
  if (contexts.length > 0) {
    youtubeCookieStoreId = contexts[0].cookieStoreId;
  } else {
    const context = await browser.contextualIdentities.create({
      name: YOUTUBE_CONTAINER_NAME,
      color: YOUTUBE_CONTAINER_COLOR,
      icon: YOUTUBE_CONTAINER_ICON
    })
    youtubeCookieStoreId = context.cookieStoreId;
  }
}

async function containYoutube (options) {
  // Listen to requests and open Youtube into its Container,
  // open other sites into the default tab context
  const requestUrl = new URL(options.url);

  let isYoutube = false;
  for (let youtubeHostRE of youtubeHostREs) {
    if (youtubeHostRE.test(requestUrl.host)) {
      isYoutube = true;
      break;
    }
  }

  // We have to check with every request if the requested URL is assigned with MAC
  // because the user can assign URLs at any given time (needs MAC Events)
  if (macAddonEnabled) {
    const macAssigned = await getMACAssignment(options.url);
    if (macAssigned) {
      // This URL is assigned with MAC, so we don't handle this request
      return;
    }
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;
  if (isYoutube) {
    if (tabCookieStoreId !== youtubeCookieStoreId && !tab.incognito) {
      // See https://github.com/mozilla/contain-youtube/issues/23
      // Sometimes this add-on is installed but doesn't get a youtubeCookieStoreId ?
      if (youtubeCookieStoreId) {
        if (shouldCancelEarly(tab, options)) {
          return {cancel: true};
        }
        browser.tabs.create({
          url: requestUrl.toString(),
          cookieStoreId: youtubeCookieStoreId,
          active: tab.active,
          index: tab.index
        });
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  } else {
    if (tabCookieStoreId === youtubeCookieStoreId) {
      if (shouldCancelEarly(tab, options)) {
        return {cancel: true};
      }
      browser.tabs.create({
        url: requestUrl.toString(),
        active: tab.active,
        index: tab.index
      });
      browser.tabs.remove(options.tabId);
      return {cancel: true};
    }
  }
}

(async function init() {
  await setupMACAddonManagementListeners();
  macAddonEnabled = await isMACAddonEnabled();

  clearYoutubeCookies();
  generateYoutubeHostREs();
  await setupContainer();

  // Add the request listener
  browser.webRequest.onBeforeRequest.addListener(containYoutube, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

  // Clean up canceled requests
  browser.webRequest.onCompleted.addListener((options) => {
    if (canceledRequests[options.tabId]) {
     delete canceledRequests[options.tabId];
    }
  },{urls: ["<all_urls>"], types: ["main_frame"]});
  browser.webRequest.onErrorOccurred.addListener((options) => {
    if (canceledRequests[options.tabId]) {
      delete canceledRequests[options.tabId];
    }
  },{urls: ["<all_urls>"], types: ["main_frame"]});
})();
