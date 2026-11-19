/* Handsome 风主题视图层
 * 结构：顶栏 + 双栏布局（主栏内容 + 右侧边栏）
 * 首页：文章大图卡片流；文章列表：紧凑列表；动态页：单列说说时间线。
 * 文章详情/相册/关于/友链/友圈等复用默认渲染函数，由 style.css 覆盖为 handsome 风格。
 */
(function () {
  const M = window.__MDI__;
  if (!M) return;
  const { t, esc, api, state, app, timeAgo, thumbSrc, svgIcon, avatarSpanHtml } = M;

  const DEFAULT_CFG = {
    accent: "green",
    home_posts: 8,
    sidebar_modules: ["author", "search", "recent", "comments", "links"],
    show_moments: true,
    article_toc: true,
  };
  const cfg = Object.assign({}, DEFAULT_CFG, window.__THEME_CONFIG__ || {});
  if (!Array.isArray(cfg.sidebar_modules)) cfg.sidebar_modules = DEFAULT_CFG.sidebar_modules;
  const hp = Number(cfg.home_posts);
  cfg.home_posts = Number.isFinite(hp) && hp >= 4 ? Math.min(20, Math.floor(hp)) : DEFAULT_CFG.home_posts;
  document.documentElement.setAttribute(
    "data-accent",
    /^(green|blue|purple|red|orange)$/.test(cfg.accent) ? cfg.accent : "green"
  );
  document.documentElement.setAttribute("data-hs-toc", cfg.article_toc ? "on" : "off");

  /* ---------- 导航：插入「动态」入口 ---------- */
  function insertMomentsNav() {
    if (!cfg.show_moments) return;
    const nav = document.querySelector(".nav");
    if (nav && !nav.querySelector('[data-route="moments"]')) {
      const home = nav.querySelector('[data-route="feed"]');
      const html = '<a href="/moments" data-route="moments">动态</a>';
      if (home && home.nextSibling) home.insertAdjacentHTML("afterend", html);
      else nav.insertAdjacentHTML("afterbegin", html);
    }
    const mnav = document.querySelector(".m-nav");
    if (mnav && !mnav.querySelector('[data-route="moments"]')) {
      const home = mnav.querySelector('[data-route="feed"]');
      const html =
        '<a href="/moments" data-route="moments">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>' +
        "<span>动态</span></a>";
      if (home && home.nextSibling) home.insertAdjacentHTML("afterend", html);
      else mnav.insertAdjacentHTML("afterbegin", html);
    }
  }
  insertMomentsNav();

  /* ---------- 双栏布局 ---------- */
  function layoutHtml(inner) {
    return (
      '<div class="hs-layout">' +
      '<div class="hs-main">' + inner + "</div>" +
      '<aside class="hs-sidebar" data-hs-sidebar></aside>' +
      "</div>"
    );
  }

  /* ---------- 侧边栏 ---------- */
  function renderSidebar(el) {
    const mods = cfg.sidebar_modules;
    if (!mods.length) {
      el.innerHTML = "";
      return;
    }
    let html = "";
    const s = state.settings;
    if (mods.includes("author")) {
      html +=
        '<div class="hs-widget hs-widget-author">' +
        '<div class="hs-widget-author-avatar">' +
        avatarSpanHtml(s.author_avatar || "", s.author_name || s.site_title, "hs-author-avatar", "user") +
        "</div>" +
        '<div class="hs-widget-author-name">' + esc(s.author_name || s.site_title) + "</div>" +
        '<div class="hs-widget-author-desc">' + esc(s.about_signature || s.essay_subtitle || "") + "</div>" +
        '<a class="hs-widget-author-more" href="/about">关于我 →</a>' +
        "</div>";
    }
    if (mods.includes("search")) {
      html +=
        '<div class="hs-widget"><div class="hs-widget-title">搜索</div>' +
        '<form class="hs-sidebar-search" data-hs-search>' +
        '<input type="search" placeholder="搜索文章…" aria-label="搜索" />' +
        '<button type="submit">' + svgIcon("search", 16) + "</button>" +
        "</form></div>";
    }
    if (mods.includes("recent")) html += '<div class="hs-widget" data-hs-recent><div class="hs-widget-title">最新文章</div><div class="hs-widget-loading">加载中…</div></div>';
    if (mods.includes("comments")) html += '<div class="hs-widget" data-hs-comments><div class="hs-widget-title">最新评论</div><div class="hs-widget-loading">加载中…</div></div>';
    if (mods.includes("links")) html += '<div class="hs-widget" data-hs-links><div class="hs-widget-title">友情链接</div><div class="hs-widget-loading">加载中…</div></div>';
    if (mods.includes("photos")) html += '<div class="hs-widget" data-hs-photos><div class="hs-widget-title">最新照片</div><div class="hs-widget-loading">加载中…</div></div>';
    el.innerHTML = html;

    const searchForm = el.querySelector("[data-hs-search]");
    if (searchForm) {
      searchForm.addEventListener("submit", e => {
        e.preventDefault();
        const q = searchForm.querySelector("input").value.trim();
        if (!q) return;
        // 复用全站搜索弹层
        const btn = document.getElementById("searchBtn");
        if (btn) btn.click();
        const inp = document.getElementById("searchInput");
        if (inp) {
          inp.value = q;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }
    if (mods.includes("recent")) loadRecent(el);
    if (mods.includes("comments")) loadComments(el);
    if (mods.includes("links")) loadLinks(el);
    if (mods.includes("photos")) loadPhotos(el);
  }

  async function loadRecent(el) {
    const box = el.querySelector("[data-hs-recent]");
    if (!box) return;
    try {
      const d = await api("/api/posts?page=1&per_page=6");
      box.innerHTML =
        '<div class="hs-widget-title">最新文章</div>' +
        (d.list && d.list.length
          ? '<ul class="hs-side-list">' +
            d.list
              .map(
                p =>
                  '<li><a href="/post/' + encodeURIComponent(p.slug) + '">' + esc(p.title) + "</a>" +
                  "<span>" + timeAgo(p.created_at) + "</span></li>"
              )
              .join("") +
            "</ul>"
          : '<div class="hs-widget-empty">暂无文章</div>');
    } catch (e) {
      box.innerHTML = '<div class="hs-widget-title">最新文章</div><div class="hs-widget-empty">' + esc(e.message) + "</div>";
    }
  }

  async function loadComments(el) {
    const box = el.querySelector("[data-hs-comments]");
    if (!box) return;
    // 全站评论关闭（备案模式）：移除最新评论小部件
    if (state.settings && state.settings.comments_enabled === false) { box.remove(); return; }
    try {
      const d = await api("/api/comments/latest?limit=5");
      if (!d.list || !d.list.length) { box.remove(); return; }
      box.innerHTML =
        '<div class="hs-widget-title">最新评论</div>' +
        ('<ul class="hs-side-list hs-side-comments">' +
            d.list
              .map(c => {
                const href = c.target_type === "post" && c.post_slug ? "/post/" + encodeURIComponent(c.post_slug) : "/moments";
                const target = (c.target_excerpt || "").slice(0, 30) || "动态";
                return (
                  '<li><a href="' + href + '">' +
                  '<span class="hs-comment-text">' + esc(String(c.content || "").slice(0, 40)) + "</span>" +
                  '<span class="hs-comment-meta">' + esc(c.nickname) + " · " + esc(target) + "</span>" +
                  "</a></li>"
                );
              })
              .join("") +
            "</ul>");
    } catch (e) {
      box.innerHTML = '<div class="hs-widget-title">最新评论</div><div class="hs-widget-empty">' + esc(e.message) + "</div>";
    }
  }

  async function loadLinks(el) {
    const box = el.querySelector("[data-hs-links]");
    if (!box) return;
    try {
      const d = await api("/api/friends?category=");
      const list = (d.list || []).slice(0, 8);
      box.innerHTML =
        '<div class="hs-widget-title">友情链接</div>' +
        (list.length
          ? '<div class="hs-side-links">' +
            list
              .map(
                f =>
                  '<a href="' + esc(f.url) + '" target="_blank" rel="noopener" title="' + esc(f.name) + '">' +
                  '<img src="' + esc(f.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' +
                  "<span>" + esc(f.name) + "</span></a>"
              )
              .join("") +
            "</div>"
          : '<div class="hs-widget-empty">暂无友链</div>');
    } catch (e) {
      box.innerHTML = '<div class="hs-widget-title">友情链接</div><div class="hs-widget-empty">' + esc(e.message) + "</div>";
    }
  }

  async function loadPhotos(el) {
    const box = el.querySelector("[data-hs-photos]");
    if (!box) return;
    try {
      const d = await api("/api/photos?page=1&per_page=6");
      const list = d.list || [];
      box.innerHTML =
        '<div class="hs-widget-title">最新照片</div>' +
        (list.length
          ? '<div class="hs-side-photos">' +
            list
              .map(p => {
                const src = p.url || p.src || "";
                return '<a href="/photos"><img src="' + esc(thumbSrc(src) || src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" /></a>';
              })
              .join("") +
            "</div>"
          : '<div class="hs-widget-empty">暂无照片</div>');
    } catch (e) {
      box.innerHTML = '<div class="hs-widget-title">最新照片</div><div class="hs-widget-empty">' + esc(e.message) + "</div>";
    }
  }

  /* ---------- 文章卡片 ---------- */
  function postCardHtml(p) {
    const coverSrc = p.cover ? thumbSrc(p.cover) : "";
    const slug = encodeURIComponent(p.slug);
    const cover = coverSrc
      ? '<a class="hs-post-cover" href="/post/' + slug + '" style="background-image:url(\'' + esc(coverSrc).replace(/'/g, "%27") + '\')"></a>'
      : '<a class="hs-post-cover hs-post-cover--text" href="/post/' + slug + '"><span>' + esc(p.title) + "</span></a>";
    return (
      '<article class="hs-post-card">' +
      (p.pinned ? '<span class="hs-post-pin">' + svgIcon("pin", 12) + " 置顶</span>" : "") +
      cover +
      '<div class="hs-post-body">' +
      '<h2 class="hs-post-title"><a href="/post/' + slug + '">' + esc(p.title) + (p.status === "draft" ? ' <span class="hs-draft">草稿</span>' : "") + "</a></h2>" +
      '<p class="hs-post-excerpt">' + esc(p.excerpt || "") + "</p>" +
      '<div class="hs-post-meta">' +
      '<time datetime="' + esc(p.created_at) + '">' + timeAgo(p.created_at) + "</time>" +
      "<span>" + svgIcon("messageCircle", 14) + " " + (p.comment_count || 0) + "</span>" +
      '<a href="/post/' + slug + '">阅读全文 →</a>' +
      "</div></div></article>"
    );
  }

  function bindPager(root, page, pages, renderFn) {
    root.querySelectorAll("[data-pager]").forEach(b =>
      b.addEventListener("click", () => {
        const next = b.dataset.pager === "prev" ? page - 1 : page + 1;
        if (next >= 1 && next <= pages) renderFn(next);
        window.scrollTo({ top: 0 });
      })
    );
  }

  /* ---------- 首页：文章卡片流 + 分页 ---------- */
  async function renderFeed() {
    state.activeView = "feed";
    app.innerHTML = layoutHtml('<div class="hs-post-list"><div class="essay-loading"><span class="spinner"></span><span>加载中…</span></div></div>');
    renderSidebar(app.querySelector("[data-hs-sidebar]"));
    await renderPostListPage(1, true);
  }

  async function renderFeedPage(page) {
    state.activeView = "feed";
    await renderPostListPage(page, true);
  }

  /* ---------- 文章列表：紧凑列表 + 分页 ---------- */
  async function renderPosts() {
    state.activeView = "posts";
    app.innerHTML = layoutHtml('<div class="hs-post-list hs-post-list--compact"><div class="essay-loading"><span class="spinner"></span><span>加载中…</span></div></div>');
    renderSidebar(app.querySelector("[data-hs-sidebar]"));
    await renderPostListPage(1, false);
  }

  async function renderPostsPage(page) {
    state.activeView = "posts";
    await renderPostListPage(page, false);
  }

  async function renderPostListPage(page, isFeed) {
    const perPage = isFeed ? cfg.home_posts : 20;
    const listEl = app.querySelector(".hs-post-list");
    if (!listEl) return;
    listEl.innerHTML = '<div class="essay-loading"><span class="spinner"></span><span>加载中…</span></div>';
    try {
      const data = await api("/api/posts?page=" + page + "&per_page=" + perPage);
      const list = data.list || [];
      const total = data.total ?? list.length;
      const pages = Math.max(1, Math.ceil(total / perPage));
      const title = isFeed ? "" : '<h1 class="hs-page-title">文章</h1>';
      listEl.innerHTML =
        title +
        (list.length
          ? list
              .map(p =>
                isFeed
                  ? postCardHtml(p)
                  : '<article class="hs-list-item">' +
                    '<a class="hs-list-title" href="/post/' + encodeURIComponent(p.slug) + '">' +
                    esc(p.title) +
                    (p.pinned ? ' <span class="hs-pin">置顶</span>' : "") +
                    (p.status === "draft" ? ' <span class="hs-draft">草稿</span>' : "") +
                    "</a>" +
                    '<div class="hs-list-meta"><time datetime="' + esc(p.created_at) + '">' + timeAgo(p.created_at) + "</time><span>" + (p.comment_count || 0) + " 评论</span></div>" +
                    '<p class="hs-list-excerpt">' + esc(p.excerpt || "") + "</p>" +
                    "</article>"
              )
              .join("")
          : '<div class="hs-empty">' + svgIcon("file-text", 40) + "<span>暂无文章</span></div>");
      const pager = M.pagerHtml(page, pages);
      if (pager) {
        listEl.insertAdjacentHTML("beforeend", '<div class="hs-pager">' + pager + "</div>");
        bindPager(app, page, pages, isFeed ? renderFeedPage : renderPostsPage);
      }
    } catch (e) {
      listEl.innerHTML = '<div class="hs-empty">' + esc(e.message) + "</div>";
    }
  }

  /* ---------- 动态页：单列说说时间线（复用默认时间线组件） ---------- */
  function renderMoments() {
    state.activeView = "feed";
    // 重置默认时间线的分页状态，从第一页重新加载
    state.feed = [];
    state.cursor = null;
    state.feedDone = false;
    state.feedLoading = false;
    app.innerHTML =
      layoutHtml(
        '<div class="hs-moments">' +
          '<h1 class="hs-page-title">动态</h1>' +
          '<ul id="waterfall" class="hs-waterfall" hidden></ul>' +
          '<div class="essay-loading" id="feedLoading"><span class="spinner"></span><span>加载中…</span></div>' +
          '<div class="essay-loadmore" id="loadMore"></div>' +
          "</div>"
      );
    renderSidebar(app.querySelector("[data-hs-sidebar]"));
    M.observeLoadMore();
    M.observeResize();
    M.loadFeed();
  }

  /* ---------- 视图注册 ---------- */
  window.THEME_VIEWS = {
    feed: renderFeed,
    posts: renderPosts,
    moments: renderMoments,
    postDetail: (slug, preview) => M.renderPostDetail(slug, preview),
    photos: () => M.renderPhotos(),
    about: () => M.renderAbout(),
    links: () => M.renderLinks(),
    friends: () => M.renderFriends(),
    linksApply: () => M.renderLinksApply(),
  };
})();