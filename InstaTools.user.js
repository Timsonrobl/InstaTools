// ==UserScript==
// @name         InstaTools
// @namespace    http://tampermonkey.net/
// @version      0.2.10
// @description  Social network enhancements for power users
// @author       Timsonrobl
// @updateURL    https://github.com/Timsonrobl/InstaTools/raw/master/InstaTools.user.js
// @downloadURL  https://github.com/Timsonrobl/InstaTools/raw/master/InstaTools.user.js
// @match        *://*.instagram.com/*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.notification
// ==/UserScript==

/* global GM, unsafeWindow */

(function main() {
  // ==================== Utility functions ====================

  function debugLog(...messages) {
    // eslint-disable-next-line no-console
    console.debug(...messages);
  }

  function errorLog(...messages) {
    // eslint-disable-next-line no-console
    console.error(...messages);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchWithRetry(url, retries = 0, options = {}) {
    const permanentErrors = [404, 410];
    let tryCount = 0;
    while (true) {
      let response;
      try {
        response = await fetch(url, options);
      } catch (error) {
        errorLog(error);
      }
      if (response?.ok) return response;
      tryCount += 1;
      if (retries >= tryCount && !permanentErrors.includes(response?.status)) {
        await sleep(2000);
      } else {
        throw new Error(response?.status || "Failed to fetch");
      }
    }
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

  function getUrlFileName(URL) {
    return URL.split("/").pop().split("?")[0];
  }

  function notificationAlert(text) {
    GM.notification({
      title: "InstaTools Warning",
      text,
    });
  }

  function selfAndChildren(selector) {
    return `${selector}, ${selector} *`;
  }

  function getIdbResult(idbRequest) {
    return new Promise((resolve) => {
      idbRequest.onsuccess = () => {
        resolve(idbRequest.result);
      };
    });
  }

  function matchOrCheck(element, test) {
    if (typeof test === "function") {
      return test(element);
    }
    return element.matches(test);
  }

  function sameWidthAncestor(element) {
    let ancestor = element;
    while (ancestor.clientWidth === ancestor.parentElement?.clientWidth) {
      ancestor = ancestor.parentElement;
    }
    return ancestor;
  }

  // ==================== Initialization ====================

  // let webAppID;
  // let queryHash;
  const dataCache = {
    highlights: {},
    posts: {},
  };

  const csrfToken = document.cookie
    .split("; ")
    .find((row) => row.startsWith("csrftoken="))
    .split("=")[1];
  if (!csrfToken) {
    notificationAlert("No csrf token!");
  }

  // ==================== Script functions ====================

  function shortcodeToId(shortcode) {
    const base64Table =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const publicShortcode = shortcode.substring(0, 11);
    let bigIntId = 0n;

    publicShortcode.split("").forEach((char) => {
      bigIntId *= 64n;
      bigIntId += BigInt(base64Table.indexOf(char));
    });

    return bigIntId.toString();
  }

  function getFetchOptions(includeCsrf = false) {
    const headers = {
      "x-ig-app-id": "936619743392459",
      "x-ig-www-claim": sessionStorage.getItem("www-claim-v2"),
      "x-asbd-id": "198387",
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
      const db = await getIdbResult(window.indexedDB.open("redux", 1));
      const storeName = "paths";
      const store = db.transaction(storeName).objectStore(storeName);
      userList = await getIdbResult(store.get("users.usernameToId"));
    } catch (error) {
      errorLog(error);
    }
    if (userList?.[userName]) {
      return userList[userName];
    }

    const response = await fetchWithCsrf(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${userName}`,
    );
    return response.data.user.id;
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
    // const variables = {
    //   user_id: userId,
    //   include_chaining: true,
    //   include_reel: true,
    //   include_suggested_users: false,
    //   include_logged_out_extras: false,
    //   include_highlight_reels: true,
    //   include_live_status: true,
    // };
    // const encodedVariables = encodeURIComponent(JSON.stringify(variables));
    // return fetchWithCsrf(
    //   `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodedVariables}`,
    // );
    return fetchWithCsrf(
      `https://i.instagram.com/api/v1/highlights/${userId}/highlights_tray/`,
    );
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
    style.innerText = `
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
        font-size: x-large;
        width: 80%;
        height: 50px;
        margin: 7px 9%;
      }
      .video-dl-link {
        color: white;
        position: absolute;
        font-size: 30px;
      }
      .video-dl-link_top {
        top: 50px;
        max-width: 300px;
        right: 20px;
      }
      .video-dl-link_bottom {
        bottom: 100px;
        right: 100px;
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

  async function openHdAvatar(userName) {
    const newTab = openNewTab();
    let userInfo;
    try {
      const userId = await getUserId(userName);
      userInfo = await getUserInfo(userId);
    } catch (error) {
      return;
    }
    newTab.location.href = userInfo.user?.hd_profile_pic_url_info?.url;
  }

  function parseDashManifest(manifestString) {
    const manifest = new DOMParser().parseFromString(
      manifestString,
      "text/xml",
    );
    debugLog(manifest);
    const adaptationSet = manifest.getElementsByTagName("AdaptationSet")[0];
    const width = parseInt(
      adaptationSet.getAttribute("maxWidth") ||
        adaptationSet.getAttribute("width"),
      10,
    );
    const dashFrameRateString =
      adaptationSet.getAttribute("maxFrameRate") ||
      adaptationSet.getAttribute("frameRate");
    let frameRate;
    if (Number.isNaN(Number(dashFrameRateString))) {
      const dashFrameRateFraction = dashFrameRateString.split("/");
      frameRate =
        Number(dashFrameRateFraction[0]) / Number(dashFrameRateFraction[1]);
    } else {
      frameRate = Number(dashFrameRateString);
    }
    const videoRepresentations = [...adaptationSet.children];
    videoRepresentations.sort(
      (a, b) =>
        Number(a.getAttribute("bandwidth")) -
        Number(b.getAttribute("bandwidth")),
    );
    const maxBandwidthRepresentation = videoRepresentations.pop();
    return {
      width,
      frameRate,
      bandwidth:
        Number(maxBandwidthRepresentation.getAttribute("bandwidth")) / 1024,
      videoURL: maxBandwidthRepresentation.firstElementChild.textContent,
    };
  }

  function createDashDownloadLink(dashVideoParams, alternativeBandwidth) {
    const link = createElementPlus({
      tagName: "a",
      innerText: `Download better quality video (${Math.floor(
        dashVideoParams.bandwidth,
      )} Kb/s, +${Math.floor(
        (dashVideoParams.bandwidth / alternativeBandwidth - 1) * 100,
      )}%)`,
      href: "#",
      className: "video-dl-link video-dl-link_top",
    });
    link.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        link.innerText = "Downloading...";
        const dashResponse = await fetchWithRetry(dashVideoParams.videoURL, 2);
        if (!dashResponse) return;
        const dashVideoBlob = await dashResponse.blob();
        link.href = window.URL.createObjectURL(dashVideoBlob);
        link.download = getUrlFileName(dashVideoParams.videoURL);
        link.click();
        link.remove();
      },
      { once: true },
    );
    return link;
  }

  async function openVideoPlayer(video, playerWindow = openNewTab()) {
    const videoVersions = video.video_versions;
    let videoURL;
    if (videoVersions) {
      // new api branch
      let selectedVideoVersion = 0;
      while (
        videoVersions[selectedVideoVersion].width ===
        videoVersions?.[selectedVideoVersion + 1]?.width
      ) {
        selectedVideoVersion += 1;
      }
      videoURL = videoVersions?.[selectedVideoVersion]?.url;
    } else {
      // old api branch
      videoURL = video.video_url;
    }
    const videoResponse = await fetchWithRetry(videoURL, 2);
    if (!videoResponse) return;
    const videoBlob = await videoResponse.blob();
    const fileBandwidthEstimate =
      (videoBlob.size * 8) / 1024 / video.video_duration - 90;
    debugLog("File video bandwidth est.:", fileBandwidthEstimate);

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

    if (video?.video_dash_manifest) {
      const dashVideo = parseDashManifest(video.video_dash_manifest);
      debugLog("Dash bandwidth:", dashVideo.bandwidth);
      if (dashVideo.bandwidth > fileBandwidthEstimate * 1.1) {
        const downloadLink = createDashDownloadLink(
          dashVideo,
          fileBandwidthEstimate,
        );
        playerWindow.document.body.appendChild(downloadLink);
      }
    }

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
      download: getUrlFileName(videoURL),
      innerText: "Save (ctrl+s)",
      className: "video-dl-link video-dl-link_bottom",
      onclick: () => {
        a.remove();
      },
    });
    playerWindow.document.body.appendChild(videoElement);
    playerWindow.document.body.appendChild(a);
    const clickLink = (event) => {
      if (event.ctrlKey && event.code === "KeyS") {
        a.click();
        playerWindow.document.removeEventListener("keydown", clickLink);
      }
    };
    playerWindow.document.addEventListener("keydown", clickLink);
  }

  async function getPostData(postElement) {
    const postURLRegex = /.*\/p\/[^/]*\//;
    const postLinks = postElement.closest("article").querySelectorAll("a");
    let postUrl;
    // eslint-disable-next-line no-restricted-syntax
    for (const postLink of postLinks) {
      const match = postLink.href?.match(postURLRegex)?.[0];
      if (match) {
        postUrl = match;
        break;
      }
    }
    if (!postUrl) return null;
    if (dataCache.posts[postUrl]) {
      return dataCache.posts[postUrl];
    }
    const shortcode = postUrl.match(/\/([^/]*)\/?(?:$|\?)/)[1];
    const mediaId = shortcodeToId(shortcode);
    const postData = await fetchWithCsrf(
      `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    );
    if (!postData) return null;
    dataCache.posts[postUrl] = postData;
    return postData;
  }

  async function openPostVideo(videoElement) {
    // a hack to make Chrome focus new tab on middle mouse event
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 0);
    });
    const playerWindow = openNewTab();
    if (!videoElement) return;
    const postData = await getPostData(videoElement);
    let videoItem;
    const posterFileName = getUrlFileName(videoElement.poster);

    if (!postData?.graphql) {
      // new api branch
      const carouselMedia = postData.items?.[0]?.carousel_media;
      if (carouselMedia) {
        if (posterFileName) {
          videoItem = carouselMedia.find(
            (item) =>
              item?.media_type === 2 &&
              item?.image_versions2.candidates?.[0]?.url.includes(
                posterFileName,
              ),
          );
          openVideoPlayer(videoItem, playerWindow);
          return;
        }
        carouselMedia
          .filter((item) => item?.media_type === 2)
          .forEach((carouselVideo, index) => {
            const carouselVideoWindow =
              index === 0 ? playerWindow : openNewTab();
            openVideoPlayer(carouselVideo, carouselVideoWindow);
          });
      } else {
        videoItem = postData.items[0];
      }
    } else {
      // old api branch. To be removed after complete phase out
      const sideCar =
        postData.graphql?.shortcode_media?.edge_sidecar_to_children;
      if (sideCar) {
        videoItem =
          postData.graphql.shortcode_media.edge_sidecar_to_children.edges.find(
            (edge) =>
              edge.node.is_video &&
              edge.node.display_url.includes(posterFileName),
          ).node;
      } else {
        videoItem = postData.graphql.shortcode_media;
      }
    }
    openVideoPlayer(videoItem, playerWindow);
  }

  async function openPostImage(imgElement) {
    const srcURL = imgElement.src;
    if (!/\d{3,4}x\d{3,4}[/&_]/.test(srcURL)) {
      window.open(srcURL, "_blank");
    } else {
      const placeholderTab = openNewTab();
      const postData = await getPostData(imgElement);
      let photoItem;

      const photoFileName = getUrlFileName(srcURL);

      if (!postData?.graphql) {
        // new api branch
        const carouselMedia = postData?.items?.[0]?.carousel_media;
        if (carouselMedia) {
          photoItem = carouselMedia.find(
            (item) =>
              item?.media_type === 1 &&
              item?.image_versions2.candidates?.[0]?.url.includes(
                photoFileName,
              ),
          );
        } else {
          photoItem = postData.items[0];
        }
        placeholderTab.location.href =
          photoItem.image_versions2.candidates?.[0]?.url;
      } else {
        // old api branch. To be removed after complete phase out
        placeholderTab.location.href = srcURL;
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
        openVideoPlayer(reelItem);
      });
      const vidMark = createElementPlus({
        tagName: "div",
        textContent: "▶️",
        className: "vid-mark",
        title: "Video",
      });
      a.appendChild(vidMark);
    }

    // this mentions API is probably phased out, subject to removal in future:
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
    // this is a new version phased in instead:
    if (reelItem.story_bloks_stickers) {
      reelItem.story_bloks_stickers.forEach((sticker) => {
        if (sticker.bloks_sticker.bloks_sticker_type !== "mention") return;
        const username = sticker.bloks_sticker.sticker_data.ig_mention.username;
        const mentionPlaque = createMentionPlaque(
          `https://www.instagram.com/${username}/`,
          `@${username}`,
          sticker,
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
        textContent: `Load more (${reelItems.length - cursor - pageSize}) →`,
      });
      nextPageButton.addEventListener(
        "click",
        () => {
          nextPageButton.remove();
          renderReel(reelItems, container, cursor + pageSize, nextPageButton);
        },
        { once: true },
      );
      fragment.appendChild(nextPageButton);
    }
    const firstItem = fragment.firstElementChild;
    container.appendChild(fragment);
    firstItem.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
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
    const reelWindow = openNewTab();
    const highlightDiv =
      event.target.closest("li").firstElementChild.firstElementChild;
    const highlightName = highlightDiv.children[1].innerText;
    reelWindow.document.title = `"${highlightName}" highlight`;
    const userName = window.location.pathname.split("/")[1];
    let userHighlights;
    if (dataCache.highlights[userName]) {
      userHighlights = dataCache.highlights[userName];
    } else {
      try {
        const userId = await getUserId(userName);
        userHighlights = await getUserHighlights(userId);
      } catch {
        return;
      }
      dataCache.highlights[userName] = userHighlights;
    }
    const thumbnailFilename = getUrlFileName(
      highlightDiv.querySelector("img").src,
    );
    const highlightData = userHighlights.tray.find((highlight) =>
      highlight.cover_media.cropped_image_version.url.includes(
        thumbnailFilename,
      ),
    );
    const reelData = await getReels([highlightData.id]);
    if (!reelData) return;
    renderChronologicalReel(reelData, reelWindow.container);
  }

  async function renderTimelinePage(
    tray,
    container,
    lastSeenTime,
    lastSeenFound = false,
    cursor = 0,
    previousReelItems = [],
    previousPageButton,
  ) {
    const reelBatchSize = 9;
    const fragment = document.createDocumentFragment();
    const page = tray.slice(cursor, cursor + reelBatchSize);
    debugLog(page);
    const reelIds = page.map((trayItem) => trayItem.id);
    const reelItems = [...previousReelItems];
    const reelsData = await getReels(reelIds);
    if (previousPageButton) previousPageButton.remove();
    if (reelsData)
      reelsData.reels_media.forEach((reel) => {
        if (reel.reel_type !== "user_reel") return;
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
          nextPageButton.textContent = "Loading...";
          renderTimelinePage(
            tray,
            container,
            lastSeenTime,
            newLastSeenFound,
            cursor + reelBatchSize,
            leftoverItems,
            nextPageButton,
          );
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
    GM.setValue("lastSeenTime", sortedTray[0]?.latest_reel_media || 0);
    renderTimelinePage(sortedTray, timelineWindow.container, lastSeenReelsTime);
  }

  async function openPostMedia(event) {
    const mediaFrame = event.target.closest("li, article > div > div");
    const imgElement = mediaFrame.querySelector("img");
    if (imgElement) {
      await openPostImage(imgElement);
      return;
    }
    if (event.button !== 1) return;
    const videoElement = mediaFrame.querySelector("video");
    await openPostVideo(videoElement);
  }

  // ==================== Error reporter blocker ====================

  const ignoredErrors = ["cancelled", "InvalidStateError", "OZ_SOURCE_BUFFER"];
  function errorHandler(error) {
    if (
      !(error instanceof Error) ||
      error?.message === "ResizeObserver loop limit exceeded" ||
      ignoredErrors.includes(error?.reason?.name) ||
      error?.message === "Publish Timed Out" ||
      error?.reason?.stack?.includes("https://www.instagram.com/static/")
    )
      return;
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

  const anyClickEventHandlers = [
    {
      name: "Post Media Cover",
      selector: 'article div[tabindex="-1"] > :nth-child(2)',
      handler: openPostMedia,
    },
    {
      // Must be above tray items
      name: "Highlight item",
      selector(element) {
        if (window.location.pathname !== "/") {
          return element.matches(selfAndChildren('[role="menu"] li'));
        }
        return false;
      },
      handler: openHighlight,
    },
    {
      name: "Stories tray avatar",
      selector: selfAndChildren(
        'main > div > section > :first-child > :nth-child(2) [role="presentation"] [role="button"]',
      ),
      async handler(event) {
        const trayName =
          event.target.closest("li").firstElementChild.firstElementChild
            .children[1].firstElementChild.innerText;
        await openUserStory(trayName);
      },
    },
    {
      name: "Stories tray username",
      selector:
        'main > div > section > :first-child > :nth-child(2) [role="presentation"] button > :last-child > div',
      handler(event) {
        window.open(`/${event.target.innerText}`, "_blank");
      },
    },
    {
      name: "Post header avatar",
      selector: selfAndChildren("article header > :first-child"),
      async handler(event) {
        event.preventDefault();
        const userName =
          event.target.closest("header").children[1].firstElementChild
            .firstElementChild.firstElementChild.firstElementChild
            .firstElementChild?.innerText;
        if (!userName) return;
        await openUserStory(userName);
      },
    },
    {
      name: "Search panel avatar",
      selector: selfAndChildren(
        '[aria-hidden="false"] [role="none"] > :first-child > :first-child > :first-child',
      ),
      async handler(event) {
        event.preventDefault();
        const userName =
          event.target.closest("a").firstElementChild.children[1]
            .firstElementChild.firstElementChild.firstElementChild
            .firstElementChild.innerText;
        if (!userName) return;
        await openUserStory(userName);
      },
    },
    {
      name: "Profile page avatar",
      selector: selfAndChildren(
        "main > :first-child > header > :first-child > :first-child",
      ),
      async handler(event) {
        event.preventDefault();
        const userName = event.target
          .closest("header")
          .querySelector("h1, h2")?.innerText;
        if (!userName) return;
        await openHdAvatar(userName);
      },
    },
    {
      name: "Profile page username",
      selector: "header h1, header h2",
      async handler(event) {
        const userName = event.target.innerText;
        await openUserStory(userName);
      },
    },
    {
      name: "Tray bar",
      selector: "main > div > section > :first-child > :nth-child(2)",
      handler: openStoriesTimeline,
    },
    {
      name: "Post Image",
      selector: (target) =>
        target.clientWidth < 1000 &&
        sameWidthAncestor(target).querySelector("img")?.clientWidth > 320,
      continuePropagation: false,
      async handler({ target }) {
        await openPostImage(target.parentElement.querySelector("img"));
      },
    },
    // {
    //   // Must be last selector
    //   name: "Post Div",
    //   selector: "div",
    //   continuePropagation: true,
    //   handler: checkImageOverlay,
    // },
  ];

  const middleClickEventHandlers = [
    {
      name: "Post Video",
      selector: (target) =>
        target.clientWidth < 1000 &&
        sameWidthAncestor(target).querySelector("video")?.clientWidth > 320,
      continuePropagation: false,
      async handler({ target }) {
        const videoElement = sameWidthAncestor(target).querySelector("video");
        await openPostVideo(videoElement);
      },
    },
    {
      name: "Post Video Cover",
      selector: "article div[aria-label]",
      async handler(event) {
        const videoElement = event.target
          .closest("li, article")
          .querySelector("video");
        await openPostVideo(videoElement);
      },
    },
  ];

  let handlerLock = false;

  document.addEventListener(
    "click",
    async (event) => {
      debugLog(
        `Click at node ${event.target.tagName}: "${event.target.className}"`,
      );
      const selectedEntry = anyClickEventHandlers.find((entry) =>
        matchOrCheck(event.target, entry.selector),
      );
      if (!selectedEntry) return;
      debugLog(`${selectedEntry.name} clicked`);
      if (!selectedEntry.continuePropagation) event.stopImmediatePropagation();
      if (!handlerLock) {
        handlerLock = true;
        await selectedEntry.handler(event);
        handlerLock = false;
      }
    },
    true,
  );

  document.addEventListener(
    "auxclick",
    async (event) => {
      if (event.button !== 1) return;
      debugLog(
        `Middle click at node ${event.target.tagName}: "${event.target.className}"`,
      );
      const selectedEntry =
        anyClickEventHandlers.find((entry) =>
          matchOrCheck(event.target, entry.selector),
        ) ||
        middleClickEventHandlers.find((entry) =>
          matchOrCheck(event.target, entry.selector),
        );
      if (!selectedEntry) return;
      debugLog(`${selectedEntry.name} middle clicked`);
      event.stopImmediatePropagation();
      if (!handlerLock) {
        handlerLock = true;
        await selectedEntry.handler(event);
        handlerLock = false;
      }
    },
    true,
  );

  const scrollCancelChecks = [
    ...anyClickEventHandlers.map((entry) => entry.selector),
    ...middleClickEventHandlers.map((entry) => entry.selector),
  ];

  //  Prevent middle mouse scroll
  document.addEventListener(
    "mousedown",
    (event) => {
      if (
        event.button === 1 &&
        scrollCancelChecks.some((check) => matchOrCheck(event.target, check))
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
})();
