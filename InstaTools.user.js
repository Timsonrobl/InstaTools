// ==UserScript==
// @name         InstaTools
// @namespace    http://tampermonkey.net/
// @version      0.1.16
// @description  Social network enhancements for power users
// @author       Timsonrobl
// @updateURL    https://github.com/Timsonrobl/InstaTools/raw/master/InstaTools.user.js
// @downloadURL  https://github.com/Timsonrobl/InstaTools/raw/master/InstaTools.user.js
// @match        *://*.instagram.com/*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.notification
// @require      https://unpkg.com/idb/build/iife/index-min.js
// ==/UserScript==

/* global GM, unsafeWindow, idb */

(function main() {
  let webAppID;
  let queryHash;
  const dataCache = {
    highlights: {},
    posts: {},
  };
  let requestPending = false;
  const csrfToken = document.cookie
    .split("; ")
    .find((row) => row.startsWith("csrftoken="))
    .split("=")[1];
  if (!csrfToken) {
    notificationAlert("No csrf token!");
  }

  // ==================== Utility functions ====================

  function debugLog(message) {
    // eslint-disable-next-line no-console
    console.debug(message);
  }

  function errorLog(message) {
    // eslint-disable-next-line no-console
    console.error(message);
  }

  function fetchWithRetry(url, retries = 0, options = {}) {
    return fetch(url, options)
      .then((response) => {
        if (response.ok) {
          return response;
        }
        const permanentErrors = [404, 410];
        if (retries > 0 && !permanentErrors.includes(response.status)) {
          return fetchWithRetry(url, retries - 1, options);
        }
        throw new Error(response.status);
      })
      .catch((error) => debugLog(error.message));
  }

  function compareNumProperty(propertyName) {
    return (a, b) => b[propertyName] - a[propertyName];
  }

  function createElementPlus(options) {
    const element = document.createElement(options.tagName);
    delete options.tagName;
    Object.assign(element, options);
    return element;
  }

  function timestampToHHMM(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // ==================== Script functions ====================

  function notificationAlert(text) {
    GM.notification({
      title: "InstaTools Warning",
      text,
    });
  }

  function getFetchOptions(includeCsrf = false) {
    const headers = {
      "x-ig-app-id": webAppID,
      "x-ig-www-claim": sessionStorage.getItem("www-claim-v2"),
    };
    if (includeCsrf) {
      headers["x-csrftoken"] = csrfToken;
      headers["x-requested-with"] = "XMLHttpRequest";
    }
    return {
      headers,
      referrer: "https://www.instagram.com/",
      referrerPolicy: "strict-origin-when-cross-origin",
      method: "GET",
      mode: "cors",
      credentials: "include",
    };
  }

  async function fetchJSON(URL, retry, options) {
    try {
      const response = await fetchWithRetry(URL, retry, options);
      const dataObject = await response.json();
      debugLog(dataObject);
      return dataObject;
    } catch (error) {
      errorLog("Failed to fetch");
      errorLog(error);
      return false;
    }
  }

  function fetchWithClaim(URL) {
    return fetchJSON(URL, 1, getFetchOptions());
  }

  function fetchWithCsrf(URL) {
    return fetchJSON(URL, 1, getFetchOptions(true));
  }

  async function getUserId(userName) {
    const sharedDataUser =
      // eslint-disable-next-line no-underscore-dangle
      unsafeWindow._sharedData.entry_data.ProfilePage?.[0].graphql?.user;
    if (sharedDataUser?.username === userName) {
      return sharedDataUser.id;
    }

    let userList;
    try {
      const db = await idb.openDB("redux", 1);
      const storeName = "paths";
      const store = db.transaction(storeName).objectStore(storeName);
      userList = await store.get("users.usernameToId");
    } catch (error) {
      errorLog(error);
    }
    if (userList?.[userName]) {
      return userList[userName];
    }

    return (await getUserPageJSON(userName)).graphql.user?.id;
  }

  function getUserInfo(userId) {
    return fetchWithClaim(
      `https://i.instagram.com/api/v1/users/${userId}/info/`,
    );
  }

  async function getReels(reelIds) {
    const query = reelIds.map((reelId) => `reel_ids=${reelId}`).join("&");
    return fetchWithClaim(
      `https://i.instagram.com/api/v1/feed/reels_media/?${query}`,
    );
  }

  async function getUserHighlights(userId) {
    const variables = {
      user_id: userId,
      include_chaining: true,
      include_reel: true,
      include_suggested_users: false,
      include_logged_out_extras: false,
      include_highlight_reels: true,
      include_live_status: true,
    };
    const encodedVariables = encodeURIComponent(JSON.stringify(variables));
    return fetchWithCsrf(
      `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodedVariables}`,
    );
  }

  async function getUserPageJSON(username) {
    return fetchJSON(`https://www.instagram.com/${username}/?__a=1`, 1);
  }

  async function openHdAvatar(userName) {
    if (requestPending) return;
    requestPending = true;
    let userInfo;
    try {
      const userId = await getUserId(userName);
      userInfo = await getUserInfo(userId);
    } catch (error) {
      requestPending = false;
      return;
    }
    window.open(userInfo.user.hd_profile_pic_url_info.url, "_blank");
    requestPending = false;
  }

  async function openVideoPlayer(URL, playerWindow = openNewTab()) {
    playerWindow.container.textContent = "";
    playerWindow.document.title = "Video";
    const videoElement = createElementPlus({
      tagName: "video",
      className: "video-player",
      controls: true,
      controlsList: "nodownload",
    });
    playerWindow.document.body.style.textAlign = "center";
    playerWindow.document.body.style.margin = 0;
    const video = await fetchWithRetry(URL, 2);
    if (!video) return;
    const videoBlob = await video.blob();
    const blobSrc = window.URL.createObjectURL(videoBlob);
    videoElement.src = blobSrc;
    videoElement.addEventListener("durationchange", () => {
      if (videoElement.duration < 8) {
        videoElement.loop = true;
      }
    });
    const a = createElementPlus({
      tagName: "a",
      href: blobSrc,
      download: URL.split("/").pop().split("?")[0],
      innerText: "Save (ctrl+s)",
      className: "video-dl-link",
      onclick: () => {
        a.remove();
      },
    });
    playerWindow.document.body.appendChild(videoElement);
    playerWindow.document.body.appendChild(a);
    playerWindow.document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.code === "KeyS") {
        a.click();
      }
    });
  }

  async function openPostVideo(event) {
    const videoElement =
      event.target.parentElement.querySelector(".tWeCl, .Q9bIO");
    if (!videoElement) return;
    if (!videoElement.src.startsWith("b")) {
      openVideoPlayer(videoElement.src);
    } else {
      const postUrl = event.target
        .closest(".ePUX4")
        ?.querySelector(".c-Yi7")?.href;
      if (!postUrl) return;
      let postData;
      // a hack to make Chrome focus new tab on middle mouse event
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, 0);
      });
      const playerWindow = openNewTab();
      if (dataCache.posts[postUrl]) {
        postData = dataCache.posts[postUrl];
      } else {
        postData = await fetchJSON(`${postUrl}?__a=1`, 1);
        if (!postData) {
          return;
        }
        dataCache.posts[postUrl] = postData;
      }
      const sideCar =
        postData.graphql.shortcode_media?.edge_sidecar_to_children;
      if (sideCar) {
        const posterFileName = videoElement.poster.match(/^([^?]*)/)[1];
        if (!posterFileName) return;
        const currentVideo = sideCar.edges.find(
          (edge) =>
            edge.node.is_video &&
            edge.node.display_url.startsWith(posterFileName),
        );
        openVideoPlayer(currentVideo.node.video_url, playerWindow);
      } else if (postData.graphql.shortcode_media?.is_video) {
        openVideoPlayer(
          postData.graphql.shortcode_media?.video_url,
          playerWindow,
        );
      }
    }
  }

  function createMentionPlaque(href, title, position) {
    const mentionPlaque = createElementPlus({
      tagName: "a",
      className: "mention-plaque",
      href,
      target: "_blank",
      rel: "noreferrer",
    });
    if (title) {
      mentionPlaque.title = title;
    }
    if (position) {
      mentionPlaque.style.width = `${position.width * 100}%`;
      mentionPlaque.style.height = `${position.height * 100}%`;
      mentionPlaque.style.top = `${(position.y - position.height / 2) * 100}%`;
      mentionPlaque.style.left = `${(position.x - position.width / 2) * 100}%`;
      mentionPlaque.style.transform = `rotate(${position.rotation}turn)`;
    }
    return mentionPlaque;
  }

  async function asyncLoadImage(imgElement, URL) {
    const imageData = await fetchWithRetry(URL, 2);
    if (imageData) {
      const imageBlob = await imageData.blob();
      imgElement.src = window.URL.createObjectURL(imageBlob);
    } else {
      imgElement.alt = "image gone (video might still be there)";
    }
  }

  function renderReelItem(reelItem) {
    const a = createElementPlus({
      tagName: "a",
      target: "_blank",
      rel: "noreferrer",
      className: "story-block",
    });
    const takenAt = new Date(reelItem.taken_at * 1000);
    const imageCandidate = reelItem.image_versions2.candidates.find(
      (candidate) => candidate.width === 320,
    );
    const img = createElementPlus({
      tagName: "img",
      className: "story-thumbnail",
      title: takenAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
      width: imageCandidate?.width || 320,
      height: imageCandidate?.height || 320,
    });
    a.appendChild(img);
    if (reelItem.media_type === 1) {
      a.href = reelItem.image_versions2.candidates[0].url;
    } else {
      img.addEventListener("click", () => {
        openVideoPlayer(reelItem.video_versions[0].url);
      });
      const vidMark = createElementPlus({
        tagName: "div",
        textContent: "▶️",
        className: "vid-mark",
        title: "Video",
      });
      a.appendChild(vidMark);
    }
    if (reelItem.reel_mentions) {
      reelItem.reel_mentions.forEach((mention) => {
        const mentionPlaque = createMentionPlaque(
          `https://www.instagram.com/${mention.user.username}/`,
          `@${mention.user.username}`,
          mention,
        );
        a.appendChild(mentionPlaque);
      });
    }
    if (reelItem.story_feed_media) {
      const mentionPlaque = createMentionPlaque(
        `https://www.instagram.com/p/${reelItem.story_feed_media[0].media_code}/`,
        null,
        reelItem.story_feed_media[0],
      );
      a.appendChild(mentionPlaque);
    }
    if (reelItem.story_link_stickers) {
      reelItem.story_link_stickers.forEach((linkSticker) => {
        const stickerURL = new URL(linkSticker.story_link.url);
        const stickerURLParams = new URLSearchParams(stickerURL.search);
        const mentionPlaque = createMentionPlaque(
          stickerURLParams.get("u"),
          null,
          linkSticker,
        );
        a.appendChild(mentionPlaque);
      });
    }
    asyncLoadImage(img, imageCandidate?.url);
    return a;
  }

  function renderReel(reelItems, container, cursor = 0) {
    const pageSize = 15;
    const fragment = document.createDocumentFragment();
    reelItems.slice(cursor, cursor + pageSize).forEach((reelItem) => {
      const reelItemElement = renderReelItem(reelItem);
      fragment.appendChild(reelItemElement);
    });
    if (reelItems.length - cursor > pageSize) {
      const nextPageButton = createElementPlus({
        tagName: "button",
        className: "next-page-button",
        textContent: `${reelItems.length - cursor - pageSize} more→`,
      });
      nextPageButton.addEventListener("click", () => {
        renderReel(reelItems, container, cursor + pageSize);
        nextPageButton.remove();
      });
      fragment.appendChild(nextPageButton);
    }
    const firstItem = fragment.firstElementChild;
    container.appendChild(fragment);
    firstItem.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  // TO-DO: make all calls synchronous
  function openNewTab() {
    const newTab = window.open();
    if (!newTab) {
      notificationAlert(
        "Disable pop-ups blocking for instagram.com in Chrome for this to work",
      );
      throw new Error("PopUpBlocked");
    }
    const style = document.createElement("style");
    style.innerHTML = `
      body {
        background-color: #222;
      }
      .container {
        display: flex;
        position: relative;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
      }
      .video-player {
        height: 100%;
      }
      .story-block {
        position: relative;
        text-decoration: none;
        margin: 5px;
        scroll-margin-top: 5px;
        cursor: pointer;
        animation: fadein 0.5s;
      }
      @keyframes fadein {
        from {
          opacity:0;
        }
        to {
          opacity:1;
        }
      }
      .story-thumbnail {
        min-width: 300px;
        min-height: 510px;
        border-radius: 5px;
      }
      .vid-mark {
        position: absolute;
        bottom: 4%;
        right: 5%;
        width: fit-content;
      }
      .mention-plaque{
        position: absolute;
        z-index: 1;
        box-sizing: border-box;
        border: thick #f008;
        border-style: dashed solid;
        border-width: 2px;
        color: #3330;
        min-height: 7px;
        margin-top: -3px;
      }
      .mention-plaque:hover {
        border-color: blue;
      }
      .next-page-button {
        position: absolute;
        right: 0;
        bottom: 100px;
        padding: 5px;
        font-size: large;
      }
      .video-dl-link {
        color: white;
        position: absolute;
        right: 100px;
        bottom: 100px;
        font-size: 30px;
      }
      .name-plaque {
        position: absolute;
        text-decoration: none;
        color: white;
        background: #111;
        width: fit-content;
        bottom: 0;
        left: 0;
      }
      .seen-divider {
        position: relative;
        width: 0px;
        outline: red solid 3px;
        height: 550px;
        overflow: visible;
      }
      .timestamp-label {
        position: absolute;
        z-index: 1;
        background: red;
        top: 45%;
        outline: red solid 3px;
        margin-left: -32px;
        color: white;
        font-size: 25px;
        font-weight: bold;
        font-family: sans-serif;
      }
      .load-spinner {
        display: inline-block;
        margin-top: 150px;
        width: 150px;
        height: 150px;
        border: 3px solid rgba(255,255,255,.3);
        border-radius: 50%;
        border-top-color: #fff;
        animation: spin 1.5s ease-in-out infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    newTab.document.head.appendChild(style);

    const container = createElementPlus({
      tagName: "div",
      className: "container",
    });
    newTab.document.body.appendChild(container);
    const spinner = createElementPlus({
      tagName: "div",
      className: "load-spinner",
    });
    container.appendChild(spinner);
    newTab.container = container;

    return newTab;
  }

  function renderChronologicalReel(reelData, container) {
    const reelItemsChronological = [...reelData.reels_media[0].items].reverse();
    container.textContent = "";
    renderReel(reelItemsChronological, container);
  }

  async function openUserStory(userName) {
    const reelWindow = openNewTab();
    reelWindow.document.title = `${userName}'s story`;
    let reelData;
    try {
      const userId = await getUserId(userName);
      reelData = await getReels([userId]);
    } catch {
      return;
    }
    if (reelData.reels_media?.length) {
      renderChronologicalReel(reelData, reelWindow.container);
    } else {
      reelWindow.close();
    }
  }

  async function openHighlight(event) {
    if (requestPending) return;
    requestPending = true;
    const reelWindow = openNewTab();
    const highlightDiv = event.target.closest("._3D7yK");
    const highlightName = highlightDiv.querySelector(".eXle2").innerText;
    reelWindow.document.title = `"${highlightName}" highlight`;
    const userName = window.location.pathname.slice(1, -1);
    let userHighlights;
    if (dataCache.highlights[userName]) {
      userHighlights = dataCache.highlights[userName];
    } else {
      try {
        const userId = await getUserId(userName);
        userHighlights = await getUserHighlights(userId);
      } catch {
        requestPending = false;
        return;
      }
      dataCache.highlights[userName] = userHighlights;
    }
    const thumbnailFilename = highlightDiv
      .querySelector(".NCYx-")
      .src.match(/^([^?]*)/)[1];
    const highlightData =
      userHighlights.data.user.edge_highlight_reels.edges.find((edge) =>
        edge.node.cover_media_cropped_thumbnail.url.startsWith(
          thumbnailFilename,
        ),
      );
    const reelData = await getReels([`highlight%3A${highlightData.node.id}`]);
    if (!reelData) return;
    renderChronologicalReel(reelData, reelWindow.container);
    requestPending = false;
  }

  async function renderTimelinePage(
    tray,
    container,
    lastSeenTime,
    lastSeenFound = false,
    cursor = 0,
    previousReelItems = [],
  ) {
    const reelBatchSize = 9;
    const fragment = document.createDocumentFragment();
    const page = tray.slice(cursor, cursor + reelBatchSize);
    debugLog(page);
    const reelIds = page.map((trayItem) => trayItem.id);
    const reelItems = [...previousReelItems];
    const reelsData = await getReels(reelIds);
    if (reelsData)
      reelsData.reels_media.forEach((reel) => {
        reel.items.forEach((reelItem) => {
          reelItem.user = reelsData.reels[reelItem.user.pk].user;
          reelItems.push(reelItem);
        });
      });
    if (reelItems.length === 0) return;
    reelItems.sort(compareNumProperty("taken_at"));
    const leftoverItems = [];
    let newLastSeenFound = lastSeenFound;
    const nextPageTime = tray[cursor + reelBatchSize]?.latest_reel_media || 0;
    reelItems.forEach((reelItem) => {
      if (reelItem.taken_at < nextPageTime) {
        leftoverItems.push(reelItem);
        return;
      }
      if (!newLastSeenFound && reelItem.taken_at <= lastSeenTime) {
        newLastSeenFound = true;
        const seenDiv = createElementPlus({
          tagName: "div",
          className: "seen-divider",
        });
        const lastSeenTimeString = timestampToHHMM(lastSeenTime * 1000);
        const timestampLabel = createElementPlus({
          tagName: "div",
          className: "timestamp-label",
          innerText: lastSeenTimeString,
        });
        seenDiv.appendChild(timestampLabel);
        fragment.appendChild(seenDiv);
      }
      const itemElement = renderReelItem(reelItem);
      const namePlaque = createElementPlus({
        tagName: "a",
        className: "name-plaque",
        target: "_blank",
        innerText: reelItem.user.username,
        href: `https://www.instagram.com/${reelItem.user.username}/`,
      });
      itemElement.appendChild(namePlaque);
      fragment.appendChild(itemElement);
    });

    if (tray.length - cursor > reelBatchSize) {
      const nextPageButton = createElementPlus({
        tagName: "button",
        className: "next-page-button",
        textContent: `${timestampToHHMM(nextPageTime * 1000)} →`,
      });
      nextPageButton.addEventListener(
        "click",
        () => {
          renderTimelinePage(
            tray,
            container,
            lastSeenTime,
            newLastSeenFound,
            cursor + reelBatchSize,
            leftoverItems,
          );
          nextPageButton.remove();
        },
        { once: true },
      );
      fragment.appendChild(nextPageButton);
    }
    if (cursor === 0) container.innerText = "";
    const firstItem = fragment.firstElementChild;
    container.appendChild(fragment);
    firstItem.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  async function openStoriesTimeline() {
    const timelineWindow = openNewTab();
    timelineWindow.document.title = "Stories Timeline";
    const trayData = await fetchWithClaim(
      "https://i.instagram.com/api/v1/feed/reels_tray/",
    );
    const sortedTray = [...trayData.tray].sort(
      compareNumProperty("latest_reel_media"),
    );
    const lastSeenReelsTime = (await GM.getValue("lastSeenTime")) || 0;
    GM.setValue("lastSeenTime", sortedTray[0].latest_reel_media);
    renderTimelinePage(sortedTray, timelineWindow.container, lastSeenReelsTime);
  }

  // ==================== Error reporter blocker ====================

  const ignoredErrors = ["cancelled", "InvalidStateError", "OZ_SOURCE_BUFFER"];
  function errorHandler(error) {
    if (error.message === "ResizeObserver loop limit exceeded") return;
    if (ignoredErrors.includes(error.reason?.name)) return;
    if (error.message === "Publish Timed Out") return;
    if (error.reason.stack?.includes("https://www.instagram.com/static/")) {
      return;
    }
    debugLog("Error intercepted!");
    errorLog(error);
    error.stopImmediatePropagation();
    notificationAlert("Error intercepted!");
  }
  window.addEventListener("error", errorHandler, true);
  window.addEventListener("unhandledrejection", errorHandler, true);
  setTimeout(() => {
    unsafeWindow.onerror = null;
    unsafeWindow.onunhandledrejection = null;
  }, 1000);

  // ==================== Main ====================

  const postImageSelector = ".ZyFrc ._9AhH0";
  const clickEventHandlers = [
    {
      name: "Post image",
      selector: postImageSelector,
      handler(event) {
        window.open(
          event.target.parentElement.firstChild.firstChild.src,
          "_blank",
        );
      },
    },
    {
      name: "Highlight item",
      selector: "._3D7yK, ._3D7yK *",
      handler: openHighlight,
    },
    {
      name: "Stories tray avatar",
      selector: ".QN629, .QN629 *",
      handler: (event) => {
        if (requestPending) return;
        requestPending = true;
        const trayName = event.target
          .closest(".Fd_fQ")
          .querySelector(".eebAO").innerText;
        openUserStory(trayName);
        requestPending = false;
      },
    },
    {
      name: "Stories tray username",
      selector: ".eebAO",
      handler(event) {
        window.open(`/${event.target.innerText}`, "_blank");
      },
    },
    {
      name: "Small avatar",
      selector: ".pZp3x, .pZp3x *",
      handler(event) {
        event.preventDefault();
        const userName = event.target
          .closest(".pZp3x")
          .nextSibling?.querySelector(".ZIAjV")?.innerText;
        if (!userName) return;
        if (requestPending) return;
        requestPending = true;
        openUserStory(userName);
        requestPending = false;
      },
    },
    {
      name: "Profile page avatar",
      selector: ".eC4Dz, .eC4Dz *",
      handler(event) {
        event.preventDefault();
        const userName = event.target
          .closest(".eC4Dz")
          .nextSibling?.querySelector(".fKFbl")?.innerText;
        if (!userName) return;
        openHdAvatar(userName);
      },
    },
    {
      name: "Profile page username",
      selector: ".fKFbl",
      handler(event) {
        if (requestPending) return;
        requestPending = true;
        const userName = event.target.innerText;
        openUserStory(userName);
        requestPending = false;
      },
    },
    {
      name: "Tray bar",
      selector: ".zGtbP",
      handler: openStoriesTimeline,
    },
  ];

  document.addEventListener(
    "click",
    (event) => {
      debugLog(
        `Click at node ${event.target.tagName}: "${event.target.className}"`,
      );
      const selectedEntry = clickEventHandlers.find((entry) =>
        event.target.matches(entry.selector),
      );
      if (!selectedEntry) return;
      debugLog(`${selectedEntry.name} clicked`);
      event.stopImmediatePropagation();
      selectedEntry.handler(event);
    },
    true,
  );

  const timelineVideoSelector = ".fXIG0, .tWeCl, .Q9bIO";
  document.addEventListener(
    "auxclick",
    async (event) => {
      if (event.button !== 1) return;
      // ==================== Post video ====================

      if (event.target.matches(timelineVideoSelector)) {
        debugLog(`Post video (${timelineVideoSelector}) middle-clicked`);
        event.stopImmediatePropagation();
        event.preventDefault();
        openPostVideo(event);
      } else if (event.target.matches(postImageSelector)) {
        debugLog(`Post image (${postImageSelector}) middle-clicked`);
        event.stopImmediatePropagation();
        event.preventDefault();
        window.open(
          event.target.parentElement.firstChild.firstChild.src,
          "_blank",
        );
      }
    },
    true,
  );
  document.addEventListener(
    "mousedown",
    (event) => {
      //  Prevent middle mouse scroll
      if (
        event.button === 1 &&
        (event.target.matches(timelineVideoSelector) ||
          event.target.matches(postImageSelector))
      ) {
        event.preventDefault();
      }
    },
    true,
  );

  //  Prevent double click event handlers
  document.addEventListener(
    "dblclick",
    (event) => {
      event.stopImmediatePropagation();
    },
    true,
  );

  // ==================== Script parser ====================

  document.addEventListener("DOMContentLoaded", async () => {
    // Parsing hardcoded app-ID and queryHash
    const scriptElement = document.head.querySelector(
      "link[href*='ConsumerLibCommons.js']",
    );
    if (!scriptElement) {
      errorLog("ERROR: unable to locate ConsumerLibCommons.js");
      return;
    }
    try {
      const response = await fetchWithRetry(scriptElement.href, 1);
      const responseText = await response.text();
      webAppID = responseText.match(/instagramWebDesktopFBAppId='(\d+)/)[1];
      debugLog(`app-id: ${webAppID}`);
      queryHash = responseText.match(
        /const .="([^"]+).*(?<=fetchHighlightReels)/,
      )[1];
      debugLog(`queryHash: ${queryHash}`);
      if (!(webAppID && queryHash)) {
        notificationAlert("Error parsing appID and query hash!");
      }
      if (webAppID !== "936619743392459") {
        notificationAlert("App ID changed, beware!");
      }
    } catch (error) {
      notificationAlert("ERROR: unable to parse hardcoded values");
      errorLog(error);
    }
  });
})();
