/* 极简留白主题（minimal）—— 页面视图层。
 * 依赖 app.js 暴露的 window.__MDI__（共享工具与状态）。
 * 组件（评论/音乐/视频/灯箱/翻译/点赞/回复/删除/后台弹窗）复用默认主题的 CSS 打底与事件委托。
 * 本文件只需定义 window.THEME_VIEWS，route() 会自动分发对应页面渲染。
 */
(function () {
  const M = window.__MDI__;
  if (!M || typeof window.THEME_VIEWS !== "undefined") return;
  const { t, esc, svgIcon, api, setSeo, state, app } = M;

  let feedObserver = null;
  let friendsObserver = null;

  /* ---------- 通用：页面头部（眉题 + 大标题 + 副标题） ---------- */
  function pageHead(eyebrow, title, sub, extra) {
    return `
      <header class="mn-head">
        ${eyebrow ? `<div class="mn-eyebrow">${esc(eyebrow)}</div>` : ""}
        <h1 class="mn-title">${title}</h1>
        ${sub ? `<p class="mn-sub">${sub}</p>` : ""}
        ${extra || ""}
      </header>`;
  }

  /* ================= 首页 / 即刻时间线（单列） ================= */
  function feed() {
    state.activeView = "feed";
    const s = state.settings;
    const fq = new URLSearchParams(location.search).get("q") || "";
    setSeo({
      title: fq ? t("feed.search_title", { q: fq, site: s.site_title }) : s.site_title,
      description: s.essay_subtitle,
      path: fq ? "/?q=" + encodeURIComponent(fq) : "/",
      image: s.banner_bg_mode === "random" ? location.origin + "/api/bg" : s.banner_bg_image,
    });
    state.feed = [];
    state.cursor = null;
    state.feedDone = false;
    state.feedLoading = false;
    state.commentTarget = null;

    const filterBar = fq ? `
      <div class="mn-filter">
        <span>${t("feed.filter_only", { q: "<b>" + esc(fq) + "</b>" })}</span>
        <a href="/" data-route="feed">${t("feed.clear_filter")}</a>
      </div>` : "";

    const adminBtn = state.admin
      ? `<div class="mn-actions"><button type="button" class="mn-btn" data-act="publish-fab">${svgIcon("plus", 14)} ${t("feed.publish")}</button></div>`
      : "";

    app.innerHTML = `
      <div class="mn-page mn-feed">
        ${pageHead(s.essay_tips, esc(s.essay_title || s.site_title), esc(s.essay_subtitle || ""), adminBtn)}
        ${filterBar}
        <ul class="mn-feed-list" id="mnFeedList"></ul>
        <div class="mn-feed-more" id="mnLoadMore"></div>
        <ul id="waterfall" hidden></ul>
      </div>`;
    observeFeedLoadMore();
    loadMoreFeed();
  }

  function setFeedMoreText() {
    const el = document.getElementById("mnLoadMore");
    if (!el) return;
    if (state.feedLoading) el.innerHTML = `<span class="spinner"></span><span>${t("feed.loading_more")}</span>`;
    else if (!state.feedDone) el.innerHTML = `<span>${t("feed.scroll_more")}</span>`;
    else el.innerHTML = state.feed.length ? `<span>${t("feed.reached_end")}</span>` : "";
  }

  async function loadMoreFeed() {
    if (state.feedLoading || state.feedDone) return;
    state.feedLoading = true;
    setFeedMoreText();
    try {
      const fq = new URLSearchParams(location.search).get("q") || "";
      const q = new URLSearchParams({ voter_id: state.voterId, limit: String(M.feedPageSize()) });
      if (state.cursor) q.set("cursor", String(state.cursor));
      if (fq) q.set("q", fq);
      const data = await api("/api/feed?" + q.toString());
      if (state.activeView !== "feed" || !document.getElementById("mnFeedList")) return;
      state.feed = state.feed.concat(data.list);
      state.cursor = data.nextCursor;
      state.feedDone = !data.nextCursor;
      const list = document.getElementById("mnFeedList");
      list.insertAdjacentHTML("beforeend", data.list.map(M.feedItemHtml).join(""));
      M.hydrateVideos(list);
      M.hydrateMusicCards(list);
    } catch (e) {
      const el = document.getElementById("mnLoadMore");
      if (el) {
        el.innerHTML = `<span>${t("common.retry_suffix", { msg: esc(e.message) })}</span>`;
        el.style.cursor = "pointer";
        el.onclick = () => { el.onclick = null; el.style.cursor = ""; loadMoreFeed(); };
      }
    } finally {
      state.feedLoading = false;
      setFeedMoreText();
    }
  }

  function observeFeedLoadMore() {
    if (feedObserver) feedObserver.disconnect();
    const sentinel = document.getElementById("mnLoadMore");
    if (!sentinel) return;
    feedObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !state.feedLoading && !state.feedDone) loadMoreFeed();
    }, { rootMargin: "300px 0px 300px 0px", threshold: 0 });
    feedObserver.observe(sentinel);
  }

  /* ================= 文章列表 ================= */
  async function posts(page = 1) {
    state.activeView = "posts";
    app.innerHTML = `<div class="mn-page"><div class="mn-loading"><span class="spinner"></span><span>${t("common.loading")}</span></div></div>`;
    try {
      const data = await api(`/api/posts?page=${page}&per_page=20`);
      if (state.activeView !== "posts") return;
      const list = data.list;
      const total = data.total ?? list.length;
      const pages = Math.max(1, Math.ceil(total / 20));
      if (!list.length && page > 1) return posts(pages); // 原页被删空时自动回退
      setSeo({ title: `${t("posts.title")} · ${state.settings.site_title}`, description: t("posts.total", { n: total }), path: "/posts" });
      const adminBtn = state.admin ? `<div class="mn-actions"><button class="mn-btn" data-act="new-post">＋ 写文章</button></div>` : "";
      const items = list.length ? list.map(p => `
        <a class="mn-post-item" href="/post/${encodeURIComponent(p.slug)}">
          <h2 class="mn-post-title">${p.pinned ? `<span class="mn-pin">${svgIcon("pin", 12)}</span>` : ""}${esc(p.title)}${p.status === "draft" ? '<span class="mn-draft">草稿</span>' : ""}</h2>
          ${p.excerpt ? `<p class="mn-post-excerpt">${esc(p.excerpt)}</p>` : ""}
          <div class="mn-post-meta">
            ${p.cover ? `<span class="mn-post-cover"><img src="${esc(M.thumbSrc(p.cover))}" alt="" loading="lazy" data-orig="${esc(p.cover)}" /></span>` : ""}
            <time>${M.timeAgo(p.created_at)}</time>
          </div>
        </a>`).join("")
        : `<div class="mn-empty">${t("posts.empty")}</div>`;
      app.innerHTML = `<div class="mn-page">
        ${pageHead("", t("posts.title"), t("posts.total", { n: total }), adminBtn)}
        <div class="mn-post-list">${items}</div>
        ${M.pagerHtml(page, pages)}
      </div>`;
      app.querySelectorAll("[data-pager]").forEach(b =>
        b.addEventListener("click", () => {
          posts(b.dataset.pager === "prev" ? page - 1 : page + 1);
          window.scrollTo({ top: 0 });
        })
      );
    } catch (e) {
      app.innerHTML = `<div class="mn-page"><div class="mn-empty">${esc(e.message)}</div></div>`;
    }
  }

  /* ================= 文章详情（复用默认实现，CSS 覆盖为极简阅读版） ================= */
  function postDetail(slug, preview) {
    M.renderPostDetail(slug, preview);
  }

  /* ================= 相册 ================= */
  async function photos(page = 1) {
    state.activeView = "photos";
    app.innerHTML = `<div class="mn-page"><div class="mn-loading"><span class="spinner"></span><span>${t("common.loading")}</span></div></div>`;
    try {
      const data = await api(`/api/photos?page=${page}&per_page=24`);
      if (state.activeView !== "photos") return;
      const list = data.list || [];
      const total = data.total ?? list.length;
      const pages = Math.max(1, Math.ceil(total / 24));
      if (!list.length && page > 1) return photos(pages); // 原页被删空时自动回退
      setSeo({ title: `${t("photos.title")} · ${state.settings.site_title}`, description: t("photos.total", { n: total }), path: "/photos" });
      const grid = list.length ? `<div class="photos-grid">${list.map(p => {
        const ts = M.thumbSrc(p.src);
        const orig = M.fullSrc(p.src);
        return `
          <a class="photo-item" data-lightbox="${esc(orig)}" rel="external nofollow noreferrer">
            <img src="${esc(ts)}" alt="${esc(p.title || "")}" loading="lazy" referrerpolicy="no-referrer"${ts !== orig ? ` data-orig="${esc(orig)}"` : ""} />
            ${p.title ? `<span class="photo-title">${esc(p.title)}</span>` : ""}
          </a>`;
      }).join("")}</div>`
        : `<div class="mn-empty">${t("photos.empty_hint")}</div>`;
      app.innerHTML = `<div class="mn-page">
        ${pageHead("", t("photos.title"), t("photos.total", { n: total }))}
        ${grid}
        ${M.pagerHtml(page, pages)}
      </div>`;
      app.querySelectorAll("[data-pager]").forEach(b =>
        b.addEventListener("click", () => {
          photos(b.dataset.pager === "prev" ? page - 1 : page + 1);
          window.scrollTo({ top: 0 });
        })
      );
    } catch (e) {
      app.innerHTML = `<div class="mn-page"><div class="mn-empty">${esc(e.message)}</div></div>`;
    }
  }

  /* ================= 关于我（复用默认渲染 + 极简 CSS 覆盖） ================= */
  function about() {
    M.renderAbout();
  }

  /* ================= 友情链接（复用默认渲染 + 极简 CSS 覆盖） ================= */
  function links() {
    M.renderLinks();
  }

  /* ================= 友圈（单列信息流） ================= */
  async function friends() {
    state.activeView = "friends";
    app.innerHTML = `<div class="mn-page"><div class="mn-loading"><span class="spinner"></span><span>${t("common.loading")}</span></div></div>`;
    try {
      state.friendsPage = 1;
      state.friendsLoading = false;
      state.friendsDone = false;
      const data = await api("/api/friends/posts?page=1");
      const posts = data.list || [];
      state.friendsTotal = Number(data.total || 0);
      state.friendsDone = !data.has_more;
      setSeo({ title: `友圈 · ${state.settings.site_title}`, description: "朋友们的最新动态", path: "/friends" });
      app.innerHTML = `<div class="mn-page">
        ${pageHead("FRIENDS", "友圈", state.friendsTotal ? `朋友们的最新动态 · 共 ${state.friendsTotal} 篇` : "")}
        ${posts.length
          ? `<div class="mn-friends-list" id="mnFriendsList">${posts.map(M.friendPostCardHtml).join("")}</div>
             <div class="mn-feed-more" id="mnFriendsMore"></div>`
          : `<div class="mn-empty">友圈还没有动态</div>`}
      </div>`;
      if (posts.length) {
        M.bindFriendCardClicks(document.getElementById("mnFriendsList"));
        setFriendsMoreText();
        observeFriendsLoadMore();
      }
    } catch (e) {
      app.innerHTML = `<div class="mn-page"><div class="mn-empty">${esc(e.message)}</div></div>`;
    }
  }

  function setFriendsMoreText() {
    const el = document.getElementById("mnFriendsMore");
    if (!el) return;
    if (state.friendsLoading) el.innerHTML = `<span class="spinner"></span><span>${t("feed.loading_more")}</span>`;
    else if (!state.friendsDone) el.innerHTML = `<span>${t("feed.scroll_more")}</span>`;
    else el.innerHTML = state.friendsTotal ? `<span>${t("feed.reached_end")}</span>` : "";
  }

  function observeFriendsLoadMore() {
    if (friendsObserver) friendsObserver.disconnect();
    const sentinel = document.getElementById("mnFriendsMore");
    if (!sentinel) return;
    friendsObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !state.friendsLoading && !state.friendsDone) loadMoreFriends();
    }, { rootMargin: "300px 0px 300px 0px", threshold: 0 });
    friendsObserver.observe(sentinel);
  }

  async function loadMoreFriends() {
    if (state.friendsLoading || state.friendsDone) return;
    state.friendsLoading = true;
    setFriendsMoreText();
    try {
      const next = state.friendsPage + 1;
      const data = await api(`/api/friends/posts?page=${next}`);
      const list = document.getElementById("mnFriendsList");
      if (list && data.list && data.list.length) {
        list.insertAdjacentHTML("beforeend", data.list.map(M.friendPostCardHtml).join(""));
        M.bindFriendCardClicks(list);
      }
      state.friendsPage = next;
      state.friendsDone = !data.has_more;
    } catch (e) {
      state.friendsDone = true; // 失败后停止滚动触发，避免反复报错
      M.toast(e.message);
    } finally {
      state.friendsLoading = false;
      setFriendsMoreText();
    }
  }

  /* ================= 申请友链（复用默认渲染 + 极简 CSS 覆盖） ================= */
  function linksApply() {
    M.renderLinksApply();
  }

  window.THEME_VIEWS = { feed, posts, postDetail, photos, about, links, friends, linksApply };
})();