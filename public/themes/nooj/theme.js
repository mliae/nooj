/* ==========================================================================
   Nooj 主题 · 视图层（清新绿 + 白色圆角卡片）
   --------------------------------------------------------------------------
   视觉依据：白底卡片、薄荷绿渐变、圆角、细边框、绿色强调色，
   顶栏常驻搜索框 + 日期胶囊，首页统计行 + Featured 大卡 + 双列文章卡 + 右侧栏。
   只覆盖读者端页面；后台仍走默认 UI。
   ========================================================================== */
(function () {
  "use strict";
  const M = window.__MDI__;
  if (!M || window.__NJ_THEME_LOADED__) return;
  window.__NJ_THEME_LOADED__ = true;

  const {
    t,
    esc,
    api,
    setSeo,
    state,
    app,
    svgIcon,
    thumbSrc,
    fullSrc,
    plainText,
    pagerHtml,
    parseRows,
    momentCardHtml,
    renderContentHtml,
    imagesGridHtml,
    videosHtml,
    friendAvatar,
    friendLastPostHtml,
    hydrateVideos,
    hydrateMusicCards,
    navigate,
    toast,
  } = M;

  const cfg = Object.assign({ home_posts: 7, show_moments: true }, window.__THEME_CONFIG__ || {});
  const startYear = new Date().getFullYear();

  /* ---------- 主题文案（多语言：简 / 繁 / EN） ---------- */
  const NJ_T = {
    "nj.nav.home": ["首页", "首頁", "Home"],
    "nj.nav.posts": ["文章", "文章", "Posts"],
    "nj.nav.moments": ["动态", "動態", "Moments"],
    "nj.nav.photos": ["相册", "相冊", "Photos"],
    "nj.nav.links": ["友链", "友鏈", "Links"],
    "nj.nav.friends": ["友圈", "友圈", "Circle"],
    "nj.nav.about": ["关于", "關於", "About"],
    "nj.nav.admin": ["后台", "後台", "Admin"],
    "nj.stat.posts": ["篇文章", "篇文章", "posts"],
    "nj.stat.photos": ["张照片", "張照片", "photos"],
    "nj.stat.friends": ["位朋友", "位朋友", "friends"],
    "nj.stat.writing": ["持续写作", "持續寫作", "of writing"],
    "nj.time.year": ["{n} 年", "{n} 年", "{n} yr"],
    "nj.time.day": ["{n} 天", "{n} 天", "{n} days"],
    "nj.chip.all": ["全部", "全部", "All"],
    "nj.sec.latest": ["最新文章", "最新文章", "Latest Posts"],
    "nj.sec.count": ["共 {n} 篇", "共 {n} 篇", "{n} posts"],
    "nj.sec.viewall": ["查看全部文章", "查看全部文章", "View all posts"],
    "nj.sec.recent_moments": ["最近动态", "最近動態", "Recent Moments"],
    "nj.sec.moments_note": ["随手记下的片段", "隨手記下的片段", "Bits of daily life"],
    "nj.tag.pinned": ["置顶", "置頂", "Pinned"],
    "nj.tag.essay": ["随笔", "隨筆", "Essay"],
    "nj.tag.note": ["记录", "記錄", "Notes"],
    "nj.read.full": ["阅读全文", "閱讀全文", "Read more"],
    "nj.read.more": ["阅读", "閱讀", "Read"],
    "nj.read.minutes": ["约 {n} 分钟读完", "約 {n} 分鐘讀完", "{n} min read"],
    "nj.meta.minutes": ["约 {n} 分钟", "約 {n} 分鐘", "{n} min read"],
    "nj.moment.fallback": ["一条动态", "一條動態", "A moment"],
    "nj.music.loading": ["音乐加载中…", "音樂載入中…", "Loading music…"],
    "nj.side.blogger": ["关于博主", "關於博主", "About Me"],
    "nj.side.explore": ["逛逛", "逛逛", "Explore"],
    "nj.side.recent": ["近期文章", "近期文章", "Recent Posts"],
    "nj.side.comments": ["最新评论", "最新評論", "Latest Comments"],
    "nj.side.saying": ["每日一言", "每日一言", "Daily Saying"],
    "nj.cm.owner": ["博主", "博主", "Author"],
    "nj.side.all": ["全部", "全部", "All"],
    "nj.side.numbers": ["一些数字", "一些數字", "By the Numbers"],
    "nj.side.contact": ["联系方式", "聯繫方式", "Contact"],
    "nj.about.blogger_bio": ["写点代码，记点生活。", "寫點代碼，記點生活。", "Code and life, noted down."],
    "nj.about.intro_empty": ["还没有写下自我介绍。", "還沒有寫下自我介紹。", "No introduction yet."],
    "nj.about.me": ["关于我", "關於我", "About Me"],
    "nj.about.timeline": ["时间线", "時間線", "Timeline"],
    "nj.about.recent": ["最近写的", "最近寫的", "Recent Posts"],
    "nj.about.recent_writing": ["最近写的", "最近寫的", "Recent writing"],
    "nj.about.intro_title": ["自我介绍", "自我介紹", "Introduction"],
    "nj.footer.craft": ["由博主亲笔搭建", "由博主親筆搭建", "Handcrafted by the blogger"],
    "nj.footer.running": ["本站已运行 {n} 天", "本站已運行 {n} 天", "Running for {n} days"],
    "nj.footer.written": ["用 ♡ 与 ✎ 写成", "用 ♡ 與 ✎ 寫成", "Made with ♡ and ✎"],
    "nj.ph.posts": ["文章", "文章", "Posts"],
    "nj.ph.archive_sub": ["共 {n} 篇 · 记录开发折腾、项目与生活日常。", "共 {n} 篇 · 記錄開發折騰、項目與生活日常。", "{n} posts on coding, projects and life."],
    "nj.ph.moments": ["动态", "動態", "Moments"],
    "nj.ph.moments_sub": ["短句、照片与片段 · 共 {n} 条", "短句、照片與片段 · 共 {n} 條", "Short notes, photos and bits · {n} in total"],
    "nj.ph.photos": ["相册", "相冊", "Photos"],
    "nj.ph.photos_sub": ["{n} 张照片 · 照片比文字更直接。", "{n} 張照片 · 照片比文字更直接。", "{n} photos · pictures speak louder."],
    "nj.ph.links": ["朋友们", "朋友們", "Friends"],
    "nj.ph.links_sub": ["{n} 个站点 · 本月新增 {n2} 个", "{n} 個站點 · 本月新增 {n2} 個", "{n} sites · {n2} new this month"],
    "nj.ph.apply": ["申请友链", "申請友鏈", "Apply"],
    "nj.ph.circle": ["友圈", "友圈", "Circle"],
    "nj.ph.circle_sub": ["朋友们的最新动态 · 共 {n} 篇", "朋友們的最新動態 · 共 {n} 篇", "Latest from friends · {n} posts"],
    "nj.ph.search": ["搜索", "搜索", "Search"],
    "nj.ph.search_sub": ["关键词「{q}」· 共 {n} 条结果", "關鍵詞「{q}」· 共 {n} 條結果", 'Query "{q}" · {n} results'],
    "nj.ph.clear": ["清除筛选", "清除篩選", "Clear filter"],
    "nj.title.search": ["搜索：{q}", "搜索：{q}", "Search: {q}"],
    "nj.title.posts": ["文章", "文章", "Posts"],
    "nj.title.moments": ["动态", "動態", "Moments"],
    "nj.title.photos": ["相册", "相冊", "Photos"],
    "nj.title.links": ["友链", "友鏈", "Links"],
    "nj.title.about": ["关于", "關於", "About"],
    "nj.title.friends": ["友圈", "友圈", "Circle"],
    "nj.loading": ["加载中", "載入中", "Loading"],
    "nj.loading.home": ["首页加载中", "首頁載入中", "Loading home"],
    "nj.loading.posts": ["文章加载中", "文章載入中", "Loading posts"],
    "nj.loading.search": ["搜索中", "搜索中", "Searching"],
    "nj.loading.moments": ["动态加载中", "動態載入中", "Loading moments"],
    "nj.loading.photos": ["相册加载中", "相冊載入中", "Loading photos"],
    "nj.loading.links": ["友链加载中", "友鏈載入中", "Loading links"],
    "nj.loading.about": ["关于加载中", "關於載入中", "Loading about"],
    "nj.loading.friends": ["友圈加载中", "友圈載入中", "Loading circle"],
    "nj.empty.posts": ["还没有文章", "還沒有文章", "No posts yet"],
    "nj.empty.posts_sub": ["第一篇正在路上。后台写下的内容会立刻出现在这里。", "第一篇正在路上。後台寫下的內容會立刻出現在這裡。", "The first post is on its way. Publish from the admin and it appears here instantly."],
    "nj.empty.archive": ["这里还没有文章", "這裡還沒有文章", "Nothing here yet"],
    "nj.empty.archive_sub": ["后台写下的第一篇文章会出现在这里。", "後台寫下的第一篇文章會出現在這裡。", "The first post published from the admin will show up here."],
    "nj.empty.moments": ["还没有动态", "還沒有動態", "No moments yet"],
    "nj.empty.moments_sub": ["随手写一句，也算留下痕迹。", "隨手寫一句，也算留下痕跡。", "Write a short note and leave a trace."],
    "nj.empty.photos": ["相册还是空的", "相冊還是空的", "The gallery is empty"],
    "nj.empty.photos_sub": ["后台可以批量上传照片。", "後台可以批量上傳照片。", "Upload photos in batches from the admin."],
    "nj.empty.links_cat": ["这个分类还没有友链", "這個分類還沒有友鏈", "No links in this category"],
    "nj.empty.links_cat_sub": ["去申请一个，或者换个分类看看。", "去申請一個，或者換個分類看看。", "Apply for one, or browse another category."],
    "nj.empty.friends": ["友圈还是空的", "友圈還是空的", "The circle is empty"],
    "nj.empty.friends_sub": ["友链站点更新后，这里会自动出现他们的新文章。", "友鏈站點更新後，這裡會自動出現他們的新文章。", "New posts from linked sites will appear here automatically."],
    "nj.empty.search": ["没有找到相关的内容", "沒有找到相關的內容", "Nothing found"],
    "nj.empty.search_sub": ["换一个关键词，或者回到首页随便翻翻。", "換一個關鍵詞，或者回到首頁隨便翻翻。", "Try another keyword, or head back home."],
    "nj.btn.new_post": ["写第一篇文章", "寫第一篇文章", "Write the first post"],
    "nj.btn.write": ["写文章", "寫文章", "Write"],
    "nj.btn.moment": ["发布动态", "發布動態", "New moment"],
    "nj.btn.loadmore": ["加载更多", "載入更多", "Load more"],
    "nj.btn.retry": ["重试", "重試", "Retry"],
    "nj.end.reached": ["— 已经到底了 —", "— 已經到底了 —", "— You have reached the end —"],
    "nj.rss.title": ["RSS 订阅", "RSS 訂閱", "RSS feed"],
    "nj.tw.humidity": ["湿度", "濕度", "Humidity"],
    "nj.tw.updated": ["更新于", "更新於", "Updated"],
    "nj.tw.feels": ["体感", "體感", "Feels"],
    "nj.tw.air": ["空气", "空氣", "Air"],
    "nj.tw.air.good": ["良", "良", "Good"],
    "nj.tw.air.ok": ["一般", "一般", "Fair"],
    "nj.tw.air.poor": ["较差", "較差", "Poor"],
    "nj.tw.tip.title": ["贴心提示", "貼心提示", "Tip"],
    "nj.links.lazy": ["这个人很懒，什么都没写。", "這個人很懶，什麼都沒寫。", "This friend hasn't written anything yet."],
    "nj.links.disabled": ["友链功能未开启", "友鏈功能未開啟", "Links are disabled"],
    "nj.friends.disabled": ["友圈功能未开启", "友圈功能未開啟", "The circle is disabled"],
    "nj.fr.untitled": ["无标题", "無標題", "Untitled"],
    "nj.fr.readmore": ["阅读原文", "閱讀原文", "Read post"],
    "nj.err.title": ["页面没能加载", "頁面沒能載入", "Page failed to load"],
    "nj.err.reload": ["重新加载", "重新載入", "Reload"],
    "nj.slogan": ["代码与生活，皆有迹可循", "代碼與生活，皆有跡可循", "Code and life, all traceable."],
    "nj.moments.desc": ["生活里的碎片", "生活裡的碎片", "Fragments of daily life"],
    "nj.photos.desc": ["照片比文字更直接。", "照片比文字更直接。", "Pictures speak louder than words."],
    "nj.friends.desc": ["朋友们的最新动态", "朋友們的最新動態", "Latest from friends"],
    "nj.mom.filter": ["筛选", "篩選", "Filter"],
    "nj.mom.bymonth": ["按月", "按月", "By month"],
    "nj.mom.byloc": ["地点", "地點", "Places"],
    "nj.mom.noloc": ["未定位", "未定位", "No location"],
    "nj.mom.earlier": ["更早", "更早", "Earlier"],
    "nj.mom.type.image": ["图文", "圖文", "Media"],
    "nj.mom.type.text": ["纯文字", "純文字", "Text"],
    "nj.mom.type.music": ["音乐", "音樂", "Music"],
    "nj.mom.loadmore": ["加载更早的", "載入更早的", "Load earlier"],
    "nj.mom.like": ["点赞", "點讚", "Like"],
    "nj.mom.like_short": ["赞", "讚", "Like"],
    "nj.mom.unlike": ["取消点赞", "取消點讚", "Unlike"],
    "nj.mom.comment": ["评论", "評論", "Comment"],
    "nj.video": ["视频", "影片", "Video"],
    "nj.end.friends": ["— 已经到底啦 —", "— 已經到底啦 —", "— That's all —"],
    "nj.side.projects": ["项目展示", "項目展示", "Projects"],
    "nj.side.embed": ["推荐", "推薦", "Featured"],
    "nj.pj.visit": ["访问项目", "訪問項目", "Visit"],
    "nj.pj.repo": ["开源代码", "開源代碼", "Source"],
  };

  function tr(key, vars) {
    const row = NJ_T[key];
    if (!row) return key;
    const i18n = window.I18N;
    const lang = i18n && i18n.enabled ? i18n.lang : "zh-CN";
    let s = row[0];
    if (lang === "zh-TW") s = row[1] || row[0];
    else if (lang === "en") s = row[2] || row[0];
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? "" : String(vars[k])));
    return s;
  }

  function trDuration(days) {
    if (days >= 365) return tr("nj.time.year", { n: Math.floor(days / 365) });
    return tr("nj.time.day", { n: days });
  }

  function trDate(now) {
    const i18n = window.I18N;
    const lang = i18n && i18n.enabled ? i18n.lang : "zh-CN";
    if (lang === "en") {
      const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][now.getMonth()];
      const w = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getDay()];
      return `${m} ${now.getDate()} · ${w}`;
    }
    const week = "日一二三四五六".charAt(now.getDay());
    return `${now.getMonth() + 1}月${now.getDate()}日 · 周${week}`;
  }


  /* ---------- 基础工具 ---------- */
  const pad2 = n => String(n).padStart(2, "0");

  function dateParts(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { y: "", m: "", d: "", md: "", full: "" };
    const y = String(d.getFullYear());
    const m = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    return { y, m, d: dd, md: m + "-" + dd, full: y + "-" + m + "-" + dd };
  }

  const fmtDate = iso => dateParts(iso).full;

  function readMin(text) {
    const len = String(text || "").length;
    return Math.max(2, Math.round(len / 320));
  }

  function shortText(text, len) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    return s.length > len ? s.slice(0, len) + "…" : s;
  }

  function domainOf(url) {
    return String(url || "").replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }

  function emptyBox(title, sub, extra) {
    return `<div class="nj-empty">
      <div class="nj-empty-ico">${icon("pen", 26)}</div>
      <h3>${esc(title)}</h3>
      ${sub ? `<p>${esc(sub)}</p>` : ""}
      ${extra || ""}
    </div>`;
  }

  function skeleton(kind) {
    return `<div class="nj-wrap nj-loading" aria-busy="true">
      <div class="nj-sk nj-sk--stats"></div>
      <div class="nj-sk-layout">
        <div class="nj-sk nj-sk--hero"></div>
        <div class="nj-sk nj-sk--side"></div>
      </div>
      <span class="nj-sr">${esc(kind || tr("nj.loading"))}</span>
    </div>`;
  }

  function errBox(msg) {
    return `<div class="nj-wrap"><div class="nj-empty">
      <div class="nj-empty-ico">!</div>
      <h3>${tr("nj.err.title")}</h3>
      <p>${esc(msg || tr("nj.loading"))}</p>
      <button class="nj-btn nj-btn-solid" type="button" onclick="location.reload()">${tr("nj.err.reload")}</button>
    </div></div>`;
  }

  /* ---------- 图标 ---------- */
  const ICONS = {
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  };
  function icon(name, size) {
    const raw = ICONS[name] || ICONS.pen;
    return size ? raw.replace("<svg ", `<svg width="${size}" height="${size}" `) : raw;
  }

  /* ---------- 顶栏 ---------- */
  function buildNavItems() {
    const s = state.settings || {};
    return [
      { href: "/", route: "feed", label: tr("nj.nav.home") },
      { href: "/posts", route: "posts", label: tr("nj.nav.posts") },
      cfg.show_moments === false ? null : { href: "/moments", route: "moments", label: tr("nj.nav.moments") },
      s.photos_enabled === false ? null : { href: "/photos", route: "photos", label: tr("nj.nav.photos"), cls: "photos-nav-link" },
      s.links_enabled === false ? null : { href: "/links", route: "links", label: tr("nj.nav.links"), cls: "links-nav-link" },
      { href: "/friends", route: "friends", label: tr("nj.nav.friends"), cls: "friends-nav-link" },
      s.about_enabled === false ? null : { href: "/about", route: "about", label: tr("nj.nav.about"), cls: "about-nav-link" },
    ].filter(Boolean);
  }

  function installChrome() {
    const items = buildNavItems();
    const navHtml = items
      .map(it => `<a href="${it.href}" data-route="${it.route}"${it.cls ? ` class="${it.cls}"` : ""}>${it.label}</a>`)
      .join("");
    const adminHtml = `<a href="/admin" data-route="admin" class="admin-only-nav" hidden data-i18n="nav.admin">${tr("nj.nav.admin")}</a>`;
    const nav = document.querySelector(".nav");
    if (nav) nav.innerHTML = navHtml + adminHtml;
    const mnav = document.querySelector(".m-nav");
    if (mnav) mnav.innerHTML = navHtml + adminHtml;
    ensureBrand();
    ensureTopExtras();
    ensureFooter();
  }

  function ensureBrand() {
    const brand = document.querySelector(".brand");
    if (!brand) return;
    const av = brand.querySelector(".brand-avatar");
    if (av && !av.dataset.nj) {
      av.dataset.nj = "1";
      const letter = String((state.settings || {}).author_name || (state.settings || {}).site_title || "N")
        .trim()
        .charAt(0)
        .toUpperCase();
      av.textContent = letter || "N";
    }
  }

  /* ---------- 顶栏天气胶囊 ---------- */
  // 天气文字 → 图标映射（顺序即优先级：雷 > 雪 > 雨 > 雾霾 > 晴）
  const WEATHER_ICON_MAP = [
    [/雷/, "cloud-lightning"],
    [/雪|冰雹/, "cloud-snow"],
    [/雨/, "cloud-rain"],
    [/雾|霾|沙尘|浮尘/, "cloud-fog"],
    [/晴/, "sunLine"],
  ];
  function weatherIconName(text) {
    const t = String(text || "");
    for (const row of WEATHER_ICON_MAP) if (row[0].test(t)) return row[1];
    return "cloud";
  }

  // 体感温度近似：Steadman 公式简化版，湿度越高体感越闷、低温时湿度低体感更冷
  function feelsLike(t, humidity) {
    const hum = Number(String(humidity || "").replace(/\D/g, "")) || 40;
    const hCorr = (t >= 25 ? 0.2 : t <= 10 ? -0.15 : 0) * (hum - 50);
    return Math.round(t + hCorr);
  }
  // 空气质量用天气文字反推（上游不提供 AQI）
  function airQuality(weather) {
    const t = String(weather || "");
    if (/霾|沙尘|浮尘/.test(t)) return { level: "nj.tw.air.poor", tone: "poor" };
    if (/雾/.test(t)) return { level: "nj.tw.air.ok", tone: "ok" };
    return { level: "nj.tw.air.good", tone: "good" };
  }
  // 体感标签：描述体感舒适程度
  function feelsLabel(feels) {
    if (feels <= 0) return { zh: "寒冷", en: "Freezing" };
    if (feels <= 10) return { zh: "偏冷", en: "Cold" };
    if (feels <= 18) return { zh: "凉爽", en: "Cool" };
    if (feels <= 26) return { zh: "舒适", en: "Comfy" };
    if (feels <= 32) return { zh: "偏热", en: "Warm" };
    return { zh: "炎热", en: "Hot" };
  }
  // 穿衣建议（基于温度 + 天气文字）
  function outfitTip(t, weather) {
    const tips = [];
    const isRain = /雨/.test(String(weather || ""));
    const isSnow = /雪/.test(String(weather || ""));
    if (t <= 0) tips.push(isSnow ? "暴雪天，羽绒服+毛衣必备" : "气温极低，穿羽绒服+厚毛衣");
    else if (t <= 10) tips.push("天气偏冷，建议薄外套+毛衣");
    else if (t <= 18) tips.push("早晚偏凉，长袖+薄外套");
    else if (t <= 26) tips.push("温度舒适，长袖或短袖均可");
    else tips.push("气温较高，短袖+短裤即可");
    if (isRain) tips.push("出门记得带伞");
    if (/雾|霾|沙尘/.test(String(weather || ""))) tips.push("空气质量不佳，口罩别忘");
    return tips;
  }
  // 预警 level → 色值（蓝色/黄色/橙色/红色四档）
  function alertLevelTone(level) {
    const l = String(level || "");
    if (/红/.test(l)) return "red";
    if (/橙/.test(l)) return "orange";
    if (/黄/.test(l)) return "yellow";
    return "blue";
  }

  // 天气数据全局只拉取一次；语言切换重渲染不重复请求
  let weatherState = "idle"; // idle | loading | ok | fail
  let weatherData = null;
  function loadWeather() {
    if (weatherState !== "idle") {
      return Promise.resolve(weatherState === "ok" ? weatherData : null);
    }
    weatherState = "loading";
    // 浏览器端直连 uapis.cn（CORS 友好），不传参数自动按 EdgeOne 本地边缘节点 IP 反查用户所在城市
    return fetch("https://uapis.cn/api/v1/misc/weather", {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    })
      .then(r => { if (!r.ok) throw new Error("uapis http " + r.status); return r.json(); })
      .then(j => {
        const d = j || {};
        if (!d.city) throw new Error("no city");
        weatherData = {
          province: d.province || "",
          city: d.city || "",
          district: d.district || "",
          weather: d.weather || "",
          temperature: Number(d.temperature) || 0,
          wind_direction: d.wind_direction || "",
          wind_power: d.wind_power || "",
          humidity: d.humidity || "",
          report_time: d.report_time || "",
          alerts: d.alerts || [],
          temperature1: d.temperature1,
          temperature2: d.temperature2,
          feels_like: d.feels_like || d.feels,
          visibility: d.visibility,
          aqi: d.aqi,
          aqi_desc: d.aqi_desc || d.air_quality_level,
        };
        weatherState = "ok";
        return weatherData;
      })
      .catch(() => {
        return api("/api/weather").then(d => {
          weatherData = d && d.city ? d : null;
          weatherState = weatherData ? "ok" : "fail";
          return weatherData;
        }).catch(() => { weatherState = "fail"; return null; });
      });
  }

  function tempText(t) {
    const n = typeof t === "number" ? t : Number(String(t || "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n)) return "--°";
    return `${Math.round(n)}°`;
  }

  function renderWeatherChip(chip, w) {
    const iconName = weatherIconName(w.weather);
    const tNum = Number(w.temperature) || 0;
    const feels = feelsLike(tNum, w.humidity);
    const feelsDesc = feelsLabel(feels);
    const air = airQuality(w.weather);
    const outfit = outfitTip(tNum, w.weather);
    const wind = [w.wind_direction, w.wind_power].filter(Boolean).join(" ");
    const cityLine = [w.province, w.district || w.city].filter(Boolean).join(" · ");

    // 4 项指标（湿度 / 风力 / 体感 / 空气）
    const metrics = [];
    metrics.push(`<span class="nj-tw-metric">${svgIcon("droplets", 12)}${tr("nj.tw.humidity")} <b>${esc(w.humidity || "--")}${/%$/.test(w.humidity) ? "" : "%"}</b></span>`);
    if (wind) metrics.push(`<span class="nj-tw-metric">${svgIcon("wind", 12)}<b>${esc(wind)}</b></span>`);
    metrics.push(`<span class="nj-tw-metric">${svgIcon("thermometer", 12)}${tr("nj.tw.feels")} <b>${tempText(feels)}</b></span>`);
    metrics.push(`<span class="nj-tw-metric">${svgIcon("cloud", 12)}${tr("nj.tw.air")} <b class="nj-tw-air-${air.tone}">${tr(air.level)}</b></span>`);

    // 更新时间
    let upd = "";
    if (w.report_time) {
      const rt = String(w.report_time).trim();
      upd = /^\d{4}-\d{2}-\d{2}/.test(rt)
        ? `${tr("nj.tw.updated")} ${rt.slice(5, 16)}`
        : rt.replace(/\s*发布\s*$/, "");
    }

    const alerts = (w.alerts || []).filter(a => a && a.title).slice(0, 3);
    const alertHtml = alerts.length
      ? `<span class="nj-tw-alerts">${alerts.map(a => `<span class="nj-tw-alert nj-tw-level-${alertLevelTone(a.level)}">${svgIcon("alert-triangle", 12)}<b>${esc(a.level)}</b><span>${esc(a.title)}</span></span>`).join("")}</span>`
      : "";

    chip.innerHTML =
      svgIcon(iconName, 15) +
      `<span class="nj-tw-temp">${tempText(tNum)}</span>` +
      `<span class="nj-tw-pop">` +
        `<span class="nj-tw-head"><span class="nj-tw-city">${esc(cityLine)}</span><span class="nj-tw-date">${esc(trDate(new Date()))}</span></span>` +
        `<span class="nj-tw-main">${svgIcon(iconName, 36)}<span class="nj-tw-big">${tempText(tNum)}</span><span class="nj-tw-side"><b>${esc(w.weather)}</b><em>${feelsDesc.zh || feelsDesc.en}</em></span></span>` +
        `<span class="nj-tw-grid">${metrics.join("")}</span>` +
        (outfit.length ? `<span class="nj-tw-tip">${svgIcon("sparkles", 13)}${outfit[0]}${outfit.length > 1 ? ` · ${outfit[1]}` : ""}</span>` : "") +
        alertHtml +
        (upd ? `<span class="nj-tw-upd">${svgIcon("clock", 12)}${esc(upd)}</span>` : "") +
      `</span>`;
  }

  /** 绑定天气胶囊的点击切换（移动端无 :hover，需 JS 驱动浮层） */
  function bindWeatherToggle() {
    const chip = document.querySelector(".nj-top-weather");
    if (!chip || chip.dataset.njBound === "1") return;
    chip.dataset.njBound = "1";
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");

    // 点击 / 触摸切换：桌面端已可用 :hover，这里额外支持 click 叠加 class
    chip.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      chip.classList.toggle("is-open");
    });
    // 键盘 Enter/Space
    chip.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        chip.classList.toggle("is-open");
      }
    });

    // 点外部关闭浮层（浮层是 chip 的子元素，chip 仍是"内部"）
    document.addEventListener("click", e => {
      if (!chip.classList.contains("is-open")) return;
      const target = e.target;
      if (target instanceof Node && !chip.contains(target)) {
        chip.classList.remove("is-open");
      }
    });
    // ESC 关闭
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && chip.classList.contains("is-open")) {
        chip.classList.remove("is-open");
      }
    });
  }

  function ensureTopExtras() {
    const actions = document.querySelector(".topbar-actions");
    if (!actions) return;

    let chip = actions.querySelector(".nj-top-weather");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "nj-top-weather nj-tw-loading";
      chip.innerHTML = svgIcon("cloud", 15) + `<span class="nj-tw-temp">--°</span>`;
      actions.insertBefore(chip, actions.firstChild);
    }
    // 无论 chip 是否存在都强制调 loadWeather：
    // - 首次 chip 刚创建 → weatherState="idle" → 真正发起 fetch
    // - 已存在（可能是 app.js 默认主题渲染的杭州数据）→ weatherState 可能是 "idle" 或 "loading"，但必须重拉
    //   用 weatherState !== "loading" 做去重（避免 syncChrome 多次调用时重复请求）
    if (weatherState !== "loading") {
      // 强制重置到 idle（因为之前可能有旧缓存或空数据）
      if (weatherState === "fail" || !weatherData) weatherState = "idle";
      loadWeather().then(w => {
        if (!chip.isConnected) return;
        if (!w) {
          chip.remove();
          return;
        }
        chip.classList.remove("nj-tw-loading");
        renderWeatherChip(chip, w);
        bindWeatherToggle();
      });
    } else {
      bindWeatherToggle();
    }

    if (!window.__njKbdBound) {
      window.__njKbdBound = true;
      window.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
          const btn = document.getElementById("searchBtn");
          if (btn) {
            e.preventDefault();
            btn.click();
          }
        }
      });
    }

    if (!actions.querySelector(".nj-top-btn")) {
      const rss = document.createElement("a");
      rss.className = "nj-top-btn";
      rss.href = "/rss.xml";
      rss.title = tr("nj.rss.title");
      rss.setAttribute("aria-label", tr("nj.rss.title"));
      rss.innerHTML = svgIcon("rss", 16);
      const menu = actions.querySelector("#menuToggle");
      actions.insertBefore(rss, menu || null);
    }
  }

  let footerSince = "";
  let sinceLoading = false;

  function sortPosts(list) {
    return (list || []).slice().sort((a, b) => {
      const pin = (Number(b.pinned) || 0) - (Number(a.pinned) || 0);
      if (pin) return pin;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  function rememberSince(iso) {
    if (!iso || footerSince) return;
    footerSince = iso;
    try {
      sessionStorage.setItem("nj_since", iso);
    } catch (_) {
      /* 忽略隐私模式限制 */
    }
  }

  function ensureSince() {
    if (footerSince || sinceLoading) return;
    try {
      const cached = sessionStorage.getItem("nj_since");
      if (cached) {
        footerSince = cached;
        return;
      }
    } catch (_) {
      /* 忽略隐私模式限制 */
    }
    sinceLoading = true;
    api("/api/posts?page=1&per_page=20")
      .then(d => {
        const all = sortPosts(d.list || []);
        const oldest = all[all.length - 1];
        if (oldest && oldest.created_at) {
          rememberSince(oldest.created_at);
          ensureFooter();
        }
      })
      .catch(() => {})
      .finally(() => {
        sinceLoading = false;
      });
  }

  /** 已运行天数（首页统计「持续写作」也用）：后台起始时间优先，否则用最早文章时间 */
  function runDays() {
    const raw = String((state.settings || {}).footer_run_since || footerSince || "").trim();
    if (!raw) return 0;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }

  // 页脚「已运行」计时器（每次重渲染先清掉旧的，避免路由切换后多个定时器叠加）
  let footerTimer = null;

  function ensureFooter() {
    ensureSince();
    let f = document.querySelector(".nj-footer");
    if (!f) {
      f = document.createElement("footer");
      f.className = "nj-footer";
      document.body.appendChild(f);
    }
    const s = state.settings || {};
    const year = new Date().getFullYear();
    // 后台「页脚文案」优先（管理员可写 HTML），留空时用主题默认版权行
    const custom = String(s.footer_text || "").trim();
    const firstLine = custom || `© ${year} ${esc(s.site_title || "Nooj Log")} · ${tr("nj.footer.craft")}`;
    // 自定义文案已包含标语时不重复输出第三行
    const slogan = String(s.essay_tips || "").trim();
    const sloganHtml = slogan && !custom.includes(slogan)
      ? `<p class="nj-footer-dim">${esc(slogan)}</p>`
      : !slogan && !custom
        ? `<p class="nj-footer-dim">${esc(tr("nj.slogan"))}</p>`
        : "";
    // 运行起始时间：后台配置优先，未配置时回退到最早一篇文章的发布时间
    const rawSince = String(s.footer_run_since || footerSince || "").trim();
    const startMs = rawSince ? new Date(rawSince).getTime() : NaN;
    const validSince = Number.isFinite(startMs) && startMs <= Date.now();
    // 备案号（可留空）：显示在最底部并链接工信部备案系统
    const icp = String(s.icp_number || "").trim();
    const icpHtml = icp
      ? `<p class="nj-footer-icp"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">${esc(icp)}</a></p>`
      : "";
    f.innerHTML = `<div class="nj-footer-inner">
      <p class="nj-footer-text">${firstLine}</p>
      ${validSince ? '<p class="nj-footer-run"><span class="nj-footer-since"></span></p>' : ""}
      ${sloganHtml}
      ${icpHtml}
    </div>`;
    if (footerTimer) {
      clearInterval(footerTimer);
      footerTimer = null;
    }
    const target = f.querySelector(".nj-footer-since");
    if (!validSince || !target) return;
    const pad = n => String(n).padStart(2, "0");
    const render = () => {
      const sec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const d = Math.floor(sec / 86400);
      target.textContent =
        tr("nj.footer.running", { n: d }) +
        " " +
        pad(Math.floor((sec % 86400) / 3600)) + ":" + pad(Math.floor((sec % 3600) / 60)) + ":" + pad(sec % 60);
    };
    render();
    footerTimer = setInterval(render, 1000);
  }

  function ensureMobileNav() {
    const s = state.settings || {};
    // 桌面与移动端导航标签都随语言/设置刷新（installChrome 仅首次渲染）
    buildNavItems().forEach(it => {
      const label = it.route === "feed" ? s.nav_feeds_name || it.label : it.label;
      document
        .querySelectorAll(`.nav a[data-route="${it.route}"], .m-nav a[data-route="${it.route}"]`)
        .forEach(a => {
          if (a.textContent.trim() !== label) a.textContent = label;
        });
    });
    document.querySelectorAll('.m-nav a[data-route="admin"]').forEach(a => {
      if (a.textContent.trim() !== tr("nj.nav.admin")) a.textContent = tr("nj.nav.admin");
    });
  }

  function syncChrome() {
    const s = state.settings || {};
    ensureBrand();
    ensureTopExtras();
    ensureMobileNav();
    ensureFooter();
    const hide = (sel, hidden) => document.querySelectorAll(sel).forEach(el => (el.hidden = !!hidden));
    hide(".nav .about-nav-link, .m-nav .about-nav-link", s.about_enabled === false);
    hide(".nav .photos-nav-link, .m-nav .photos-nav-link", s.photos_enabled === false);
    hide(".nav .links-nav-link, .m-nav .links-nav-link", s.links_enabled === false);
    hide(".nav .friends-nav-link, .m-nav .friends-nav-link", s.friends_enabled === false);
    hide(".nav a[data-route='moments'], .m-nav a[data-route='moments']", cfg.show_moments === false);
  }

  function markMoments(on) {
    document.querySelectorAll('[data-route="moments"]').forEach(a => a.classList.toggle("active", !!on));
  }

  /* ---------- 共用卡片 ---------- */
  function featuredHtml(p) {
    if (!p) return "";
    const dt = dateParts(p.created_at);
    const min = readMin(p.excerpt);
    const cover = p.cover
      ? `<img class="nj-featured-cover" src="${esc(thumbSrc(p.cover))}" alt="" loading="lazy" referrerpolicy="no-referrer"${thumbSrc(p.cover) !== fullSrc(p.cover) ? ` data-orig="${esc(fullSrc(p.cover))}"` : ""} />`
      : "";
    const artContent = cover ? cover : `<span class="nj-featured-ico">${icon("wrench")}</span>`;
    return `<a class="nj-featured" href="/post/${encodeURIComponent(p.slug)}">
      <div class="nj-featured-art">
        <span class="nj-featured-badge">FEATURED</span>
        ${artContent}
        <span class="nj-featured-glow"></span>
      </div>
      <div class="nj-featured-body">
        <div class="nj-featured-meta">${dt.full}<i>·</i>${esc(tr("nj.meta.minutes", { n: min }))}<i>·</i>${p.pinned ? tr("nj.tag.pinned") : esc(p.category || tr("nj.tag.essay"))}</div>
        <h2 class="nj-featured-title">${esc(p.title)}</h2>
        <span class="nj-featured-more">${tr("nj.read.full")} <i>→</i></span>
      </div>
    </a>`;
  }

  function postCard(p) {
    const dt = dateParts(p.created_at);
    const min = readMin(p.excerpt);
    const media = p.cover
      ? `<img src="${esc(thumbSrc(p.cover))}" alt="" loading="lazy" referrerpolicy="no-referrer"${
          thumbSrc(p.cover) !== fullSrc(p.cover) ? ` data-orig="${esc(fullSrc(p.cover))}"` : ""
        } />`
      : `<span class="nj-pcard-ico">${icon("wrench")}</span>`;
    return `<a class="nj-pcard" href="/post/${encodeURIComponent(p.slug)}">
      <div class="nj-pcard-media">
        ${media}
        <span class="nj-pcard-tag${p.pinned ? " is-top" : ""}">${p.pinned ? tr("nj.tag.pinned") : esc(p.category || tr("nj.tag.essay"))}</span>
      </div>
      <div class="nj-pcard-body">
        <div class="nj-pcard-meta">${dt.full}<i>·</i>${esc(tr("nj.meta.minutes", { n: min }))}</div>
        <h3 class="nj-pcard-title">${esc(p.title)}</h3>
        ${p.excerpt ? `<p class="nj-pcard-desc">${esc(shortText(p.excerpt, 96))}</p>` : ""}
        <div class="nj-pcard-foot">
          <span class="nj-chip-soft">#${p.pinned ? tr("nj.tag.pinned") : esc(p.category || tr("nj.tag.note"))}</span>
          <span class="nj-pcard-more">${tr("nj.read.more")} ${icon("arrow", 13)}</span>
        </div>
      </div>
    </a>`;
  }

  const NJ_PLAY_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.5-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14z"/></svg>';

  /** 首页动态瓦片里的视频预览：封面/画面 + 播放角标，点击进入动态页播放 */
  function momentTileVideo(v) {
    if (!v) return "";
    const play = `<span class="nj-mo-play"><i>${NJ_PLAY_SVG}</i></span>`;
    // 封面优先用视频自带，其次用后台配置的默认封面
    const poster = v.poster || state.settings?.video_default_poster || "";
    const posterHtml = /^(?:https?:\/\/|\/)/i.test(poster)
      ? `<img src="${esc(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : "";
    if (v.kind === "embed") {
      const label = v.provider === "youtube" ? "YouTube" : "Bilibili";
      return `<span class="nj-mo-video nj-mo-video--embed">${posterHtml}${play}<span class="nj-mo-vlabel">${label}</span></span>`;
    }
    // 有封面：直接用图，不加载视频
    if (posterHtml) return `<span class="nj-mo-video">${posterHtml}${play}</span>`;
    // 无封面：mp4 由 hydrateMomentTileVideos 定位到片头之后取画面；
    // HLS 浏览器原生不支持，直接浅绿占位，避免黑屏
    if (v.kind === "hls" || !v.src) {
      return `<span class="nj-mo-video nj-mo-video--embed">${play}<span class="nj-mo-vlabel">${tr("nj.video")}</span></span>`;
    }
    return `<span class="nj-mo-video" data-nj-frame>
      <video src="${esc(v.src)}" preload="metadata" muted playsinline data-nj-frame-video></video>
      ${play}<span class="nj-mo-vlabel" data-nj-vlabel hidden>${esc(tr("nj.video"))}</span>
    </span>`;
  }

  /**
   * 瓦片视频取画面：片头常是黑屏淡入，加载元数据后 seek 到约 1/4 处（1~2 秒）再取帧。
   * 解码失败/超时（跨域、编码不支持等）降级为浅绿占位 + 播放角标，绝不留黑块。
   */
  function hydrateMomentTileVideos(root) {
    root.querySelectorAll("video[data-nj-frame-video]:not([data-bound])").forEach(v => {
      v.dataset.bound = "1";
      const box = v.closest(".nj-mo-video");
      let failed = false;
      const fail = () => {
        if (failed || !box || !box.isConnected) return;
        failed = true;
        v.remove();
        box.classList.add("nj-mo-video--embed");
        const label = box.querySelector("[data-nj-vlabel]");
        if (label) label.hidden = false;
      };
      v.addEventListener(
        "loadedmetadata",
        () => {
          const dur = Number(v.duration) || 0;
          if (!dur || dur < 0.2) return;
          let t = Math.min(2, Math.max(0.5, dur * 0.25));
          if (t > dur - 0.2) t = dur * 0.5;
          try {
            v.currentTime = t;
          } catch {
            /* 部分浏览器此时还不能 seek，交给下方的 seeked/超时兜底 */
          }
        },
        { once: true }
      );
      const check = () => {
        if (v.videoWidth > 0) box && box.classList.add("is-ready");
        else fail();
      };
      v.addEventListener("seeked", check, { once: true });
      v.addEventListener("loadeddata", check, { once: true });
      v.addEventListener("error", fail, { once: true });
      setTimeout(() => {
        if (!v.isConnected) return;
        if (!v.videoWidth || v.readyState < 2) fail();
      }, 6000);
    });
  }

  function momentTile(m) {
    const imgs = Array.isArray(m.images) ? m.images : [];
    const first = imgs[0] || "";
    const vids = Array.isArray(m.videos) ? m.videos : m.video ? [m.video] : [];
    const videoHtml = momentTileVideo(vids[0]);
    const dt = dateParts(m.created_at);
    // 音乐短代码（[music=t21] 中央库 / [music=123] 旧网易云）解析成完整可播放卡片，与右下角胶囊双向同步
    const musicM = String(m.content || "").match(/\[music=(t?\d+)\]/i);
    const textContent = String(m.content || "")
      .replace(/\[music=t?\d+\][^\n\r]*(?:\r?\n|$)/gi, "")
      .trim();
    const href = `/moments#m-${m.id}`;
    const head = `<span class="nj-mo-top"><span class="nj-mo-date">${dt.md}</span>${m.location ? `<span class="nj-mo-loc">${svgIcon("locationDot", 11)}${esc(shortText(m.location, 14))}</span>` : ""}</span>`;
    const text = textContent ? `<span class="nj-mo-text">${esc(plainText(textContent, 96) || tr("nj.moment.fallback"))}</span>` : "";
    const img = first ? `<span class="nj-mo-img"><img src="${esc(thumbSrc(first))}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>` : "";
    // 视频优先于首图展示
    const media = videoHtml || img;
    const foot = `<span class="nj-mo-foot">${tr("nj.nav.moments")} →</span>`;
    if (musicM) {
      // 含音乐：瓦片拆为容器——文字/图片/底部各自是跳转链接，音乐卡独立可交互（hydrateMusicCards 水合）
      return `<div class="nj-mo nj-mo-has-music">
        <a class="nj-mo-link" href="${href}">${head}${text}</a>
        <div class="music-block-card" data-song-id="${musicM[1]}"><div class="mcc-skeleton"><span class="spinner"></span>${esc(tr("nj.music.loading"))}</div></div>
        ${media ? `<a class="nj-mo-link" href="${href}">${media}</a>` : ""}
        <a class="nj-mo-foot nj-mo-link" href="${href}">${tr("nj.nav.moments")} →</a>
      </div>`;
    }
    return `<a class="nj-mo" href="${href}">${head}${text}${media}${foot}</a>`;
  }

  function aboutCard(s, total) {
    const name = s.author_name || s.site_title || "Nooj";
    const letter = String(name).trim().charAt(0).toUpperCase() || "N";
    const avatar = s.about_avatar || s.author_avatar || s.brand_avatar || "";
    const desc = shortText(s.about_signature || s.essay_subtitle || tr("nj.about.blogger_bio"), 64);
    const avatarHtml = avatar
      ? `<img class="nj-square-avatar nj-square-avatar--img" src="${esc(avatar)}" alt="${esc(name)}" />`
      : `<span class="nj-square-avatar">${esc(letter)}</span>`;
    return `<section class="nj-card nj-about-mini">
      <div class="nj-about-mini-top">
        ${avatarHtml}
        <span>
          <span class="nj-about-mini-name">${esc(name)}</span>
          <span class="nj-about-mini-sub">${total} ${tr("nj.stat.posts")}</span>
        </span>
      </div>
      <p class="nj-about-mini-desc">${esc(desc)}</p>
    </section>`;
  }

  /** 项目展示：解析后台 projects（JSON 数组），清洗字段长度 */
  function parseProjects(raw) {
    try {
      const a = JSON.parse(String(raw || ""));
      if (!Array.isArray(a)) return [];
      return a
        .filter(p => p && typeof p === "object")
        .map(p => ({
          name: String(p.name || "").slice(0, 40),
          desc: String(p.desc || "").slice(0, 60),
          cover: String(p.cover || "").slice(0, 500),
          detail: String(p.detail || "").slice(0, 300),
          url: String(p.url || "").slice(0, 500),
          repo: String(p.repo || "").slice(0, 500),
        }))
        .filter(p => p.name)
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  /** 首页侧栏「项目展示」卡片：默认缩略条目，悬停左侧弹出详情浮层（移动端点按展开） */
  function projectsCard(s) {
    const list = parseProjects(s.projects);
    if (!list.length) return "";
    const items = list
      .map(p => {
        const letter = p.name.trim().charAt(0).toUpperCase() || "P";
        const cover = p.cover
          ? `<img class="nj-pj-cover" src="${esc(p.cover)}" alt="${esc(p.name)}" loading="lazy" />`
          : `<span class="nj-pj-cover nj-pj-cover--letter">${esc(letter)}</span>`;
        const popCover = p.cover
          ? `<img class="nj-pj-pop-cover" src="${esc(p.cover)}" alt="" loading="lazy" />`
          : "";
        const links =
          (p.url ? `<a class="nj-pj-btn" href="${esc(p.url)}" target="_blank" rel="noopener">${tr("nj.pj.visit")} ↗</a>` : "") +
          (p.repo ? `<a class="nj-pj-btn nj-pj-btn--ghost" href="${esc(p.repo)}" target="_blank" rel="noopener">${tr("nj.pj.repo")} ⌥</a>` : "");
        const pop =
          `<span class="nj-pj-pop">` +
          popCover +
          (p.detail ? `<span class="nj-pj-pop-detail">${esc(p.detail)}</span>` : "") +
          (links ? `<span class="nj-pj-pop-links">${links}</span>` : "") +
          `</span>`;
        return `<div class="nj-pj">${cover}<span class="nj-pj-info"><b>${esc(p.name)}</b>${p.desc ? `<i>${esc(p.desc)}</i>` : ""}</span>${pop}</div>`;
      })
      .join("");
    return `<section class="nj-card nj-projects">
      <h3 class="nj-card-title">${tr("nj.side.projects")}</h3>
      <div class="nj-pj-list">${items}</div>
    </section>`;
  }

  /** 首页侧栏「嵌入卡片」：后台 sidebar_embed_html（支持 iframe/任意 HTML），空则不渲染 */
  function embedCard(s) {
    const html = String(s.sidebar_embed_html || "").trim();
    if (!html) return "";
    const title = String(s.sidebar_embed_title || "").trim() || tr("nj.side.embed");
    return `<section class="nj-card nj-embed">
      <h3 class="nj-card-title">${esc(title)}</h3>
      <div class="nj-embed-body">${html}</div>
    </section>`;
  }

  function navCard(s) {
    const tags = [
      { href: "/posts", label: tr("nj.nav.posts") },
      cfg.show_moments === false ? null : { href: "/moments", label: tr("nj.nav.moments") },
      s.photos_enabled === false ? null : { href: "/photos", label: tr("nj.nav.photos") },
      s.links_enabled === false ? null : { href: "/links", label: tr("nj.nav.links") },
      { href: "/friends", label: tr("nj.nav.friends") },
      s.about_enabled === false ? null : { href: "/about", label: tr("nj.nav.about") },
    ].filter(Boolean);
    return `<section class="nj-card">
      <h3 class="nj-card-title">${tr("nj.side.explore")}</h3>
      <div class="nj-tagcloud">${tags
        .map(tag => `<a class="nj-tag" href="${tag.href}">${esc(tag.label)}</a>`)
        .join("")}</div>
      <p class="nj-card-note">${esc(shortText(s.essay_tips || tr("nj.slogan"), 40))}</p>
    </section>`;
  }

  /** 终端风格 git log 代码块（aboutCard 下方、navCard 上方） */
  function terminalCard(s) {
    const u = s?.site_title?.toLowerCase() || "nooj";
    const uname = "nooj";
    const cmd = "git log --oneline -3";
    // 取最近 3 篇文章，按时间倒序模拟 commit
    return `<section class="nj-terminal-card">
      <div class="nj-terminal-head">
        <span class="nj-terminal-dot nj-terminal-dot--r"></span>
        <span class="nj-terminal-dot nj-terminal-dot--y"></span>
        <span class="nj-terminal-dot nj-terminal-dot--g"></span>
        <span class="nj-terminal-title">${esc(uname)}@${esc(u)}: ~/blog</span>
      </div>
      <div class="nj-terminal-body">
        <div class="nj-terminal-line"><span class="nj-terminal-prompt">$</span> ${cmd}</div>
        <div class="nj-terminal-item">
          <span class="nj-terminal-dot nj-terminal-dot--g"></span>
          <span class="nj-terminal-hash">a3f9c2d</span>
          <span class="nj-terminal-msg">修复深色模式下的对比度问题</span>
        </div>
        <div class="nj-terminal-item">
          <span class="nj-terminal-dot nj-terminal-dot--m"></span>
          <span class="nj-terminal-hash">8b21e7f</span>
          <span class="nj-terminal-msg">新增 RSS 订阅入口</span>
        </div>
        <div class="nj-terminal-item">
          <span class="nj-terminal-dot nj-terminal-dot--m"></span>
          <span class="nj-terminal-hash">4d0a1c9</span>
          <span class="nj-terminal-msg">部署上线 nooj.cn</span>
        </div>
        <div class="nj-terminal-line"><span class="nj-terminal-prompt">$</span> <span class="nj-terminal-cursor"></span></div>
      </div>
    </section>`;
  }

  function recentCard(posts) {
    if (!posts.length) return "";
    return `<section class="nj-card">
      <h3 class="nj-card-title">${tr("nj.side.recent")}</h3>
      <div class="nj-recent">${posts
        .slice(0, 4)
        .map(
          p => `<a class="nj-recent-item" href="/post/${encodeURIComponent(p.slug)}">
            <span class="nj-recent-date">${dateParts(p.created_at).md}</span>
            <span class="nj-recent-title">${esc(p.title)}</span>
          </a>`
        )
        .join("")}</div>
    </section>`;
  }

  /** 每日一言卡：服务端 /api/saying（代理 uapis.cn，有缓存与本地兜底） */
  function sayingCard(text) {
    if (!text) return "";
    return `<section class="nj-card nj-saying-card">
      <h3 class="nj-card-title">
        ${svgIcon("quote", 14)}${tr("nj.side.saying")}
      </h3>
      <div class="nj-saying-quote-mark" aria-hidden="true">${svgIcon("quote", 52)}</div>
      <div class="nj-saying-inner">
        <p class="nj-saying-text">${esc(text)}</p>
      </div>
      <div class="nj-saying-foot">
        <span class="nj-saying-sep"></span>
        <span class="nj-saying-meta">${tr("nj.side.saying")} · ${esc(new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" }))}</span>
      </div>
    </section>`;
  }

  /** 最新评论卡：/api/comments/latest，文章评论跳文章页锚点，动态评论跳动态锚点 */
  function commentCard(list) {
    if (!list.length) return "";
    return `<section class="nj-card nj-comments-card">
      <h3 class="nj-card-title">${tr("nj.side.comments")}</h3>
      <div class="nj-cm-list">${list
        .map(c => {
          const href =
            c.target_type === "post" && c.post_slug
              ? `/post/${encodeURIComponent(c.post_slug)}#comments`
              : `/moments#m-${c.target_id}`;
          const letter = String(c.nickname || "?").trim().charAt(0).toUpperCase();
          const avatar = c.avatar_url
            ? `<img src="${esc(c.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
            : `<span class="nj-cm-letter">${esc(letter)}</span>`;
          return `<a class="nj-cm" href="${href}">
            <span class="nj-cm-avatar">${avatar}</span>
            <span class="nj-cm-body">
              <span class="nj-cm-nick">${esc(shortText(c.nickname, 12))}${c.is_owner ? `<i class="nj-cm-owner">${tr("nj.cm.owner")}</i>` : ""}</span>
              <span class="nj-cm-text">${esc(plainText(c.content, 44))}</span>
              <span class="nj-cm-target">${icon("arrow", 10)} ${esc(plainText(c.target_excerpt || "", 22))}</span>
            </span>
          </a>`;
        })
        .join("")}</div>
    </section>`;
  }

  function pageHead(kicker, title, sub, action) {
    return `<header class="nj-page-head">
      <div class="nj-page-head-main">
        <span class="nj-kicker">${esc(kicker)}</span>
        <h1>${esc(title)}</h1>
        ${sub ? `<p>${sub}</p>` : ""}
      </div>
      ${action || ""}
    </header>`;
  }

  /* ---------- 首页 ---------- */
  async function feed() {
    state.activeView = "feed";
    markMoments(false);
    syncChrome();

    const s = state.settings || {};
    const q = new URLSearchParams(location.search).get("q") || "";
    if (q) return searchView(q, s);

    setSeo({
      title: s.site_title || "Nooj Log",
      description: s.essay_subtitle || "",
      path: "/",
    });

    app.innerHTML = skeleton(tr("nj.loading.home"));

    const per = Math.min(12, Math.max(3, Number(cfg.home_posts) || 7));
    let posts = [];
    let total = 0;
    let moments = [];
    let photoTotal = 0;
    let friendTotal = 0;
    let latestComments = [];
    let sayingText = "";

    try {
      const reqs = [
        api("/api/posts?page=1&per_page=" + per),
        cfg.show_moments === false
          ? Promise.resolve({ list: [] })
          : api("/api/moments?limit=4&voter_id=" + encodeURIComponent(state.voterId)).catch(() => ({ list: [] })),
        api("/api/photos?page=1&per_page=1").catch(() => ({ total: 0 })),
        api("/api/friends?category=" + encodeURIComponent("全部")).catch(() => ({ stats: {} })),
        api("/api/comments/latest?limit=4").catch(() => ({ list: [] })),
        api("/api/saying").catch(() => ({ text: "" })),
      ];
      const r = await Promise.all(reqs);
      if (state.activeView !== "feed") return;
      const pd = r[0] || {};
      posts = sortPosts(pd.list || []);
      total = Number(pd.total || posts.length);
      moments = (r[1] || {}).list || [];
      photoTotal = Number((r[2] || {}).total || 0);
      friendTotal = Number(((r[3] || {}).stats || {}).total || 0);
      latestComments = (r[4] || {}).list || [];
      sayingText = String((r[5] || {}).text || "");

      if (total > posts.length) {
        try {
          const od = await api("/api/posts?page=1&per_page=20");
          const all = sortPosts(od.list || []);
          const oldest = all[all.length - 1];
          if (oldest && oldest.created_at) rememberSince(oldest.created_at);
        } catch (_) {
          /* 不影响首页 */
        }
      } else if (posts.length) {
        rememberSince(posts[posts.length - 1].created_at);
      }
    } catch (e) {
      if (state.activeView !== "feed") return;
      app.innerHTML = errBox(e.message);
      return;
    }

    let duration = tr("nj.time.year", { n: 1 });
    const ageDays = runDays();
    if (ageDays > 0) duration = trDuration(ageDays);
    ensureFooter();

    const stats = [
      { num: total, label: tr("nj.stat.posts") },
      ...(s.photos_enabled === false ? [] : [{ num: photoTotal, label: tr("nj.stat.photos") }]),
      { num: friendTotal, label: tr("nj.stat.friends") },
      { num: duration, label: tr("nj.stat.writing") },
    ];

    // 文章 ≤ 3 篇时跳过 FEATURED，全部进 grid；文章多了 FEATURED 拿最新，grid 从第 2 篇开始
    const showFeatured = posts.length > 3;
    const featured = showFeatured ? featuredHtml(posts[0]) : "";
    const gridPosts = showFeatured ? posts.slice(1) : posts;
    const cards = gridPosts.map(postCard).join("");

    // 文章分类（与后端 POST_CATEGORIES 白名单一致）；点击不跳转，AJAX 切换本区块文章列表
    const HOME_CATS = ["开发折腾", "项目展示", "生活日常"];
    const chips = `<div class="nj-chips" data-home-cats>
      <button class="nj-chip is-active" type="button" data-cat="">${tr("nj.chip.all")}</button>
      ${HOME_CATS.map(c => `<button class="nj-chip" type="button" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
    </div>`;

    const latestSection = posts.length
      ? `<section class="nj-section">
          <div class="nj-sec-head">
            <div class="nj-sec-left"><h2 class="nj-sec-title">${tr("nj.sec.latest")}</h2><span class="nj-sec-count">${esc(tr("nj.sec.count", { n: total }))}</span></div>
            ${chips}
          </div>
          ${cards ? `<div class="nj-card-grid">${cards}</div>` : ""}
          <a class="nj-more-link" href="/posts">${tr("nj.sec.viewall")} ${icon("arrow", 14)}</a>
        </section>`
      : `<section class="nj-section">
          <div class="nj-sec-head"><div class="nj-sec-left"><h2 class="nj-sec-title">${tr("nj.sec.latest")}</h2></div></div>
          ${emptyBox(
            tr("nj.empty.posts"),
            tr("nj.empty.posts_sub"),
            state.admin ? `<button class="nj-btn nj-btn-solid" type="button" data-act="new-post">${tr("nj.btn.new_post")}</button>` : ""
          )}
        </section>`;

    const tiles = moments.map(momentTile).join("");
    const momentsSection =
      cfg.show_moments === false || !tiles
        ? ""
        : `<section class="nj-section">
            <div class="nj-sec-head">
              <div class="nj-sec-left"><h2 class="nj-sec-title">${tr("nj.sec.recent_moments")}</h2><span class="nj-sec-count">${tr("nj.sec.moments_note")}</span></div>
              <a class="nj-sec-more" href="/moments">${tr("nj.chip.all")}${tr("nj.nav.moments")} →</a>
            </div>
            <div class="nj-mo-grid">${tiles}</div>
          </section>`;

    app.innerHTML = `<div class="nj-wrap nj-home">
      <section class="nj-stats">${stats
        .map(
          st => `<div class="nj-stat">
            <span class="nj-stat-num">${esc(String(st.num))}</span>
            <span class="nj-stat-label">${esc(st.label)}</span>
          </div>`
        )
        .join("")}</section>
      <div class="nj-layout">
        <div class="nj-main">
          ${featured}
          ${latestSection}
          ${momentsSection}
        </div>
        <aside class="nj-aside">
          ${aboutCard(s, total)}
          ${projectsCard(s)}
          ${embedCard(s)}
          ${terminalCard(s)}
          ${navCard(s)}
          ${recentCard(posts)}
          ${commentCard(latestComments)}
          ${sayingCard(sayingText)}
        </aside>
      </div>
    </div>`;

    // 首页分类切换：点击 chip 原地替换文章卡片列表，不跳转页面
    hydrateMusicCards(app);
    hydrateMomentTileVideos(app);
    // 项目展示：移动端无 hover，点按条目展开/收起详情浮层（桌面端由 CSS :hover 处理）
    const pjListEl = app.querySelector(".nj-pj-list");
    if (pjListEl) {
      pjListEl.addEventListener("click", e => {
        const t = e.target;
        if (!(t instanceof Element) || t.closest("a")) return;
        const item = t.closest(".nj-pj");
        if (!item) return;
        pjListEl.querySelectorAll(".nj-pj.is-open").forEach(o => {
          if (o !== item) o.classList.remove("is-open");
        });
        item.classList.toggle("is-open");
      });
    }
    const catsBox = app.querySelector("[data-home-cats]");
    if (catsBox) {
      const sec = catsBox.closest(".nj-section");
      const countEl = sec ? sec.querySelector(".nj-sec-count") : null;
      catsBox.addEventListener("click", async e => {
        const btn = e.target.closest("[data-cat]");
        if (!btn || btn.classList.contains("is-active")) return;
        catsBox.querySelectorAll(".nj-chip").forEach(b => b.classList.toggle("is-active", b === btn));
        const cat = btn.dataset.cat || "";
        let grid = sec ? sec.querySelector(".nj-card-grid") : null;
        if (grid) grid.style.opacity = "0.4";
        try {
          const d = await api("/api/posts?page=1&per_page=" + per + (cat ? "&category=" + encodeURIComponent(cat) : ""));
          if (state.activeView !== "feed") return;
          const list = sortPosts(d.list || []);
          // grid 直接显示后端返回的全部文章，不再 slice(1)
          const cardsHtml = list.map(postCard).join("");
          if (grid) {
            grid.innerHTML = cardsHtml || "";
            grid.style.opacity = "";
            grid.style.display = cardsHtml ? "" : "none";
          }
          if (countEl) countEl.textContent = tr("nj.sec.count", { n: Number(d.total || list.length) });
          // 切到无文章的分类时给出轻提示（不动结构，下次切换自动恢复）
          let emptyTip = sec ? sec.querySelector("[data-cat-empty]") : null;
          if (!cardsHtml && sec) {
            if (!emptyTip) {
              emptyTip = document.createElement("div");
              emptyTip.dataset.catEmpty = "1";
              emptyTip.style.cssText = "padding:34px 0;text-align:center;color:var(--nj-muted);font-size:13px";
              sec.insertBefore(emptyTip, sec.querySelector(".nj-more-link"));
            }
            emptyTip.textContent = tr("nj.empty.posts");
          } else if (emptyTip) {
            emptyTip.remove();
          }
        } catch (err) {
          if (grid) grid.style.opacity = "";
          toast(err.message);
        }
      });
    }
    window.scrollTo(0, 0);
  }

  /* ---------- 搜索结果 ---------- */
  async function searchView(q, s) {
    setSeo({
      title: tr("nj.title.search", { q }) + " · " + (s.site_title || "Nooj Log"),
      description: s.essay_subtitle || "",
      path: "/?q=" + encodeURIComponent(q),
    });
    app.innerHTML = skeleton(tr("nj.loading.search"));
    let posts = [];
    let moments = [];
    let friends = [];
    try {
      const d = await api("/api/search?q=" + encodeURIComponent(q));
      if (state.activeView !== "feed") return;
      posts = d.posts || [];
      moments = d.moments || [];
      friends = d.friends || [];
    } catch (e) {
      if (state.activeView !== "feed") return;
      app.innerHTML = errBox(e.message);
      return;
    }
    const total = posts.length + moments.length + friends.length;
    const rows = [
      ...posts.map(p => {
        const dt = dateParts(p.created_at);
        return `<a class="nj-result" href="/post/${encodeURIComponent(p.slug)}">
          <span class="nj-result-kind">${tr("nj.nav.posts")}</span>
          <span class="nj-result-main">
            <span class="nj-result-title">${esc(p.title)}</span>
            ${p.excerpt ? `<span class="nj-result-desc">${esc(p.excerpt)}</span>` : ""}
          </span>
          <span class="nj-result-date">${dt.full}</span>
        </a>`;
      }),
      ...moments.map(m => {
        const dt = dateParts(m.created_at);
        return `<a class="nj-result" href="/moments">
          <span class="nj-result-kind">${tr("nj.nav.moments")}</span>
          <span class="nj-result-main">
            <span class="nj-result-title">${esc(plainText(m.content, 80) || tr("nj.moment.fallback"))}</span>
            ${m.location ? `<span class="nj-result-desc">${esc(m.location)}</span>` : ""}
          </span>
          <span class="nj-result-date">${dt.full}</span>
        </a>`;
      }),
      ...friends.map(f => {
        return `<a class="nj-result" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer nofollow">
          <span class="nj-result-kind">${tr("nj.nav.links")}</span>
          <span class="nj-result-main">
            <span class="nj-result-title">${esc(f.name)}</span>
            ${f.description ? `<span class="nj-result-desc">${esc(f.description)}</span>` : ""}
          </span>
          <span class="nj-result-date">${esc(f.category || "")}</span>
        </a>`;
      }),
    ].join("");

    app.innerHTML = `<div class="nj-wrap nj-narrow">
      ${pageHead("SEARCH", tr("nj.ph.search"), tr("nj.ph.search_sub", { q: esc(q), n: total }), `<a class="nj-btn" href="/">${tr("nj.ph.clear")}</a>`)}
      ${total ? `<div class="nj-results">${rows}</div>` : emptyBox(tr("nj.empty.search"), tr("nj.empty.search_sub"))}
    </div>`;
  }

  /* ---------- 文章列表 ---------- */
  const POST_CATS = ["开发折腾", "项目展示", "生活日常"];
  async function posts() {
    state.activeView = "posts";
    markMoments(false);
    syncChrome();

    const s = state.settings || {};
    const per = 10;
    const page = Math.max(1, Number(new URLSearchParams(location.search).get("page")) || 1);
    const cat = POST_CATS.includes((new URLSearchParams(location.search).get("category") || "").trim())
      ? new URLSearchParams(location.search).get("category").trim()
      : "";
    setSeo({
      title: (cat ? `${cat} · ` : "") + tr("nj.title.posts") + " · " + (s.site_title || "Nooj Log"),
      description: cat ? `${cat}分类` : (s.essay_subtitle || ""),
      path: "/posts" + (cat ? "?category=" + encodeURIComponent(cat) : "") + (page > 1 ? (cat ? "&page=" : "?page=") + page : ""),
    });

    app.innerHTML = skeleton(tr("nj.loading.posts"));

    let list = [];
    let total = 0;
    try {
      const qs = "page=" + page + "&per_page=" + per + (cat ? "&category=" + encodeURIComponent(cat) : "");
      const d = await api("/api/posts?" + qs);
      if (state.activeView !== "posts") return;
      list = sortPosts(d.list || []);
      total = Number(d.total || list.length);
    } catch (e) {
      if (state.activeView !== "posts") return;
      app.innerHTML = errBox(e.message);
      return;
    }
    const pages = Math.max(1, Math.ceil(total / per));

    const chips = `<div class="nj-chips nj-chips--head" data-posts-cats>
      <button class="nj-chip${!cat ? " is-active" : ""}" type="button" data-cat="">${tr("nj.chip.all")}</button>
      ${POST_CATS.map(c => `<button class="nj-chip${cat === c ? " is-active" : ""}" type="button" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
    </div>`;
    const headRight = `<div class="nj-page-head-right">${chips}</div>`;

    app.innerHTML = `<div class="nj-wrap">
      ${pageHead(
        "ARCHIVE",
        cat || tr("nj.ph.posts"),
        cat ? `${cat} · 共 ${total} 篇` : tr("nj.ph.archive_sub", { n: total }),
        headRight
      )}
      ${
        list.length
          ? `<div class="nj-card-grid">${list.map(postCard).join("")}</div>`
          : emptyBox(
              tr("nj.empty.archive"),
              cat ? "该分类下暂无文章" : tr("nj.empty.archive_sub"),
              state.admin ? `<button class="nj-btn nj-btn-solid" type="button" data-act="new-post">${tr("nj.btn.new_post")}</button>` : ""
            )
      }
      ${pagerHtml(page, pages)}
    </div>`;

    // 分类 chips 切换
    const catsBox = app.querySelector("[data-posts-cats]");
    catsBox?.addEventListener("click", e => {
      const btn = e.target.closest("[data-cat]");
      if (!btn || btn.classList.contains("is-active")) return;
      catsBox.querySelectorAll(".nj-chip").forEach(b => b.classList.toggle("is-active", b === btn));
      const newCat = btn.dataset.cat || "";
      const u = new URL(location.href);
      if (newCat) u.searchParams.set("category", newCat); else u.searchParams.delete("category");
      u.searchParams.delete("page");
      navigate(u.pathname + u.search + u.hash);
    });

    // 分页（带 category）
    app.querySelectorAll("[data-pager]").forEach(btn =>
      btn.addEventListener("click", () => {
        const next = btn.dataset.pager === "prev" ? page - 1 : page + 1;
        const u = new URL(location.href);
        if (next <= 1) {
          u.searchParams.delete("page");
        } else {
          u.searchParams.set("page", String(next));
        }
        navigate(u.pathname + u.search + u.hash);
        window.scrollTo({ top: 0 });
      })
    );
  }

  /* ---------- 文章详情 ---------- */
  function postDetail() {
    state.activeView = "post";
    markMoments(false);
    syncChrome();
    const slug = decodeURIComponent(location.pathname.slice("/post/".length));
    const preview = state.admin && new URLSearchParams(location.search).get("preview") === "1";
    M.renderPostDetail(slug, preview);
    enhanceArticle();
    setTimeout(enhanceArticle, 120);
    setTimeout(enhanceArticle, 600);
  }

  function enhanceArticle() {
    if (!location.pathname.startsWith("/post/")) return;
    const card = document.querySelector(".article-card");
    if (!card) return;
    card.classList.add("nj-article");
    const meta = card.querySelector(".article-meta");
    const body = card.querySelector(".article-body");
    if (meta && body && !meta.querySelector(".nj-readtime")) {
      const min = readMin(body.textContent || "");
      const sep = meta.textContent.trim() ? '<i class="nj-dot">·</i>' : "";
      meta.insertAdjacentHTML("beforeend", `${sep}<span class="nj-readtime">${esc(tr("nj.read.minutes", { n: min }))}</span>`);
    }
    // 评论框放到评论列表上面（紧跟标题之后）
    const section = card.querySelector("[data-comment-section]");
    const form = section && section.querySelector(".comment-form-wrap");
    const title = section && section.querySelector(".comment-section-title");
    if (form && title && form.previousElementSibling !== title) {
      title.insertAdjacentElement("afterend", form);
    }
  }

  /* ---------- 动态 ---------- */
  // 月份 / 星期文案（中文用「十月」，英文用 October）
  const MOM_MONTH_ZH = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const MOM_MONTH_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const MOM_MONTH_EN_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MOM_WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const MOM_WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function momLang() {
    const i18n = window.I18N;
    return i18n && i18n.enabled ? i18n.lang : "zh-CN";
  }
  function momMonthLabel(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    if (momLang() === "en") return { main: MOM_MONTH_EN_FULL[m - 1] || ym, sub: String(y) };
    return { main: MOM_MONTH_ZH[m - 1] || ym, sub: `${MOM_MONTH_EN[m - 1] || ""} ${y}`.trim() };
  }
  function momShortMonth(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    return momLang() === "en" ? `${MOM_MONTH_EN_FULL[m - 1]} ${y}` : `${y} · ${MOM_MONTH_ZH[m - 1]}`;
  }
  function momWeekLabel(d) {
    return momLang() === "en" ? MOM_WEEK_EN[d.getDay()] : MOM_WEEK_ZH[d.getDay()];
  }
  const momPad = n => String(n).padStart(2, "0");

  async function moments() {
    state.activeView = "moments";
    markMoments(true);
    syncChrome();

    const s = state.settings || {};
    setSeo({
      title: tr("nj.title.moments") + " · " + (s.site_title || "Nooj Log"),
      description: s.essay_subtitle || tr("nj.moments.desc"),
      path: "/moments",
    });

    app.innerHTML = `<div class="nj-wrap nj-mom-page" data-nj-page>
      <aside class="nj-mom-side" data-nj-side>
        <section class="nj-mom-card">
          <h2 class="nj-mom-card-title">${esc(tr("nj.mom.filter"))}</h2>
          <div class="nj-mom-nav" data-nj-types></div>
        </section>
        <section class="nj-mom-card" data-nj-month-card>
          <h2 class="nj-mom-card-title">${esc(tr("nj.mom.bymonth"))}</h2>
          <div class="nj-mom-nav" data-nj-month-list></div>
        </section>
        <section class="nj-mom-card" data-nj-loc-card>
          <h2 class="nj-mom-card-title">${esc(tr("nj.mom.byloc"))}</h2>
          <div class="nj-mom-nav" data-nj-loc-list></div>
        </section>
      </aside>
      <main class="nj-mom-main">
        <header class="nj-mom-head">
          <h1 class="nj-mom-title">${esc(tr("nj.ph.moments"))}</h1>
          ${state.admin ? `<button class="nj-btn nj-btn-solid" type="button" data-act="publish-fab">${esc(tr("nj.btn.moment"))}</button>` : ""}
        </header>
        <div class="nj-mom-feed" data-nj-months></div>
        <div class="nj-loadmore" data-nj-more></div>
      </main>
    </div>`;

    const pageEl = app.querySelector("[data-nj-page]");
    const sideEl = app.querySelector("[data-nj-side]");
    const typesEl = app.querySelector("[data-nj-types]");
    const monthCard = app.querySelector("[data-nj-month-card]");
    const monthEl = app.querySelector("[data-nj-month-list]");
    const locCard = app.querySelector("[data-nj-loc-card]");
    const locEl = app.querySelector("[data-nj-loc-list]");
    const feedEl = app.querySelector("[data-nj-months]");
    const moreEl = app.querySelector("[data-nj-more]");
    const limit = Math.min(30, Math.max(5, Number(s.feed_page_size) || 10));

    // 供基础评论弹窗（点击评论按钮 → openCommentModal）按 id 找到动态
    state.feed = [];

    const filter = { type: "", month: "", before: "", location: "" };
    let stats = null;
    let cursor = null;
    let done = false;
    let loading = false;
    let count = 0;
    let total = 0;
    let gen = 0; // 筛选代次：切换筛选后丢弃旧请求的返回
    // 首页瓦片锚点跳转：/moments#m-123 → 加载后滚动定位到该条并短暂高亮
    const anchorId = (location.hash.match(/^#m-(\d+)$/) || [])[1] || "";
    let anchorDone = !anchorId;
    // 月份 → 该月的日期分组（增量插入，避免重复建 DOM）
    const monthGroups = new Map();

    /* ---- 左侧筛选栏 ---- */
    function renderSidebar() {
      if (!stats) return;
      const t = stats.types || {};
      const defs = [
        { key: "", label: tr("nj.chip.all"), n: stats.total },
        { key: "image", label: tr("nj.mom.type.image"), n: t.image || 0 },
        { key: "text", label: tr("nj.mom.type.text"), n: t.text || 0 },
        { key: "music", label: tr("nj.mom.type.music"), n: t.music || 0 },
      ];
      typesEl.innerHTML = defs
        .map(
          d =>
            `<button type="button" data-type="${d.key}" class="${filter.type === d.key ? "is-active" : ""}"><span>${esc(d.label)}</span><em>${d.n}</em></button>`
        )
        .join("");

      // 近 4 个月单列，其余月份合并成「更早」
      const months = stats.months || [];
      const head = months.slice(0, 4);
      const rest = months.slice(4);
      let mHtml = head
        .map(
          m =>
            `<button type="button" data-month="${m.ym}" class="${filter.month === m.ym ? "is-active" : ""}"><span>${esc(momShortMonth(m.ym))}</span><em>${m.count}</em></button>`
        )
        .join("");
      if (rest.length) {
        const older = rest.reduce((a, b) => a + b.count, 0);
        mHtml += `<button type="button" data-before="${rest[0].ym}" class="${filter.before === rest[0].ym ? "is-active" : ""}"><span>${esc(tr("nj.mom.earlier"))}</span><em>${older}</em></button>`;
      }
      monthCard.hidden = !months.length;
      monthEl.innerHTML = mHtml;

      const locs = stats.locations || [];
      locCard.hidden = !locs.length;
      locEl.innerHTML = locs
        .map(l => {
          const key = l.name || "__none__";
          return `<button type="button" data-loc="${esc(key)}" class="${filter.location === key ? "is-active" : ""}"><span>${esc(l.name || tr("nj.mom.noloc"))}</span><em>${l.count}</em></button>`;
        })
        .join("");
    }

    sideEl.addEventListener("click", e => {
      const btn = e.target.closest("button[data-type], button[data-month], button[data-before], button[data-loc]");
      if (!btn) return;
      const ds = btn.dataset;
      if ("type" in ds) {
        filter.type = filter.type === ds.type ? "" : ds.type;
      } else if ("month" in ds) {
        filter.month = filter.month === ds.month ? "" : ds.month;
        filter.before = "";
      } else if ("before" in ds) {
        filter.before = filter.before === ds.before ? "" : ds.before;
        filter.month = "";
      } else if ("loc" in ds) {
        filter.location = filter.location === ds.loc ? "" : ds.loc;
      }
      renderSidebar();
      reload();
    });

    /* ---- 主区：月份 → 日期 → 条目 ---- */
    function ensureMonth(ym) {
      let g = monthGroups.get(ym);
      if (g) return g;
      const sec = document.createElement("section");
      sec.className = "nj-mom-group";
      sec.dataset.ym = ym;
      const lab = momMonthLabel(ym);
      sec.innerHTML = `<h2 class="nj-mom-month"><span>${esc(lab.main)}</span><em>${esc(lab.sub)}</em></h2><div class="nj-mom-days"></div>`;
      const before = [...feedEl.children].find(el => el.dataset.ym < ym);
      feedEl.insertBefore(sec, before || null);
      g = { daysEl: sec.querySelector(".nj-mom-days"), days: new Map() };
      monthGroups.set(ym, g);
      return g;
    }

    function ensureDay(ym, ymd, d) {
      const g = ensureMonth(ym);
      let list = g.days.get(ymd);
      if (list) return list;
      const row = document.createElement("div");
      row.className = "nj-mom-day";
      row.dataset.day = ymd;
      row.innerHTML = `<div class="nj-mom-daynum"><span class="nj-mom-dnum">${d.getDate()}</span><span class="nj-mom-dweek">${esc(momWeekLabel(d))}</span></div><div class="nj-mom-list"></div>`;
      const before = [...g.daysEl.children].find(el => el.dataset.day < ymd);
      g.daysEl.insertBefore(row, before || null);
      list = row.querySelector(".nj-mom-list");
      g.days.set(ymd, list);
      return list;
    }

    function momentItemHtml(m, d) {
      const liked = !!m.liked;
      // 全站评论关闭（备案模式）：不渲染评论按钮与评论数
      const commentsOn = (state.settings || {}).comments_enabled !== false;
      return `<li class="bber-item nj-mom-item" data-id="${m.id}">
        <div class="nj-mom-time">${momPad(d.getHours())}:${momPad(d.getMinutes())}</div>
        <div class="nj-mom-body">
          ${m.content ? `<div class="nj-mom-text"><div class="m-xlate-content" data-mcontent>${renderContentHtml(m.content)}</div></div>` : ""}
          ${videosHtml(m)}
          ${imagesGridHtml(m)}
          <div class="nj-mom-chips">
            ${m.location ? `<span class="nj-mom-chip nj-mom-chip--loc">${svgIcon("locationDot", 12)}<span>${esc(m.location)}</span></span>` : ""}
            <button class="nj-mom-chip bber-like ${liked ? "is-liked" : ""}" type="button" data-act="like" title="${esc(tr(liked ? "nj.mom.unlike" : "nj.mom.like"))}">${svgIcon(liked ? "heartFill" : "heartLine", 14)}${m.like_count > 0 ? `<span class="bber-like-count">${m.like_count}</span>` : ""}<span class="nj-mom-chip-label">${esc(tr("nj.mom.like_short"))}</span></button>
            ${commentsOn ? `<button class="nj-mom-chip bber-reply" type="button" data-act="reply" title="${esc(tr("nj.mom.comment"))}">${svgIcon("chat", 14)}${m.comment_count > 0 ? `<span class="bber-reply-count">${m.comment_count}</span>` : ""}<span class="nj-mom-chip-label">${esc(tr("nj.mom.comment"))}</span></button>` : ""}
            ${state.admin ? `<button class="nj-mom-chip nj-mom-chip--del" type="button" data-act="del" title="删除">${svgIcon("trash", 12)}</button>` : ""}
          </div>
        </div>
      </li>`;
    }

    function renderItems(items) {
      for (const m of items) {
        const d = new Date(m.created_at);
        if (Number.isNaN(d.getTime())) continue;
        const ym = `${d.getFullYear()}-${momPad(d.getMonth() + 1)}`;
        const ymd = `${ym}-${momPad(d.getDate())}`;
        const list = ensureDay(ym, ymd, d);
        const tpl = document.createElement("template");
        tpl.innerHTML = momentItemHtml(m, d).trim();
        const li = tpl.content.firstElementChild;
        if (!li) continue;
        list.appendChild(li);
        state.feed.push(m);
      }
      hydrateVideos(feedEl);
      hydrateMusicCards(feedEl);
    }

    function paintMore() {
      if (!count) {
        moreEl.innerHTML = emptyBox(tr("nj.empty.moments"), tr("nj.empty.moments_sub"));
        return;
      }
      if (done) {
        moreEl.innerHTML = `<span class="nj-end">${esc(tr("nj.end.reached"))}</span>`;
        return;
      }
      const rest = Math.max(0, total - count);
      moreEl.innerHTML =
        `<button class="nj-mom-load" type="button" data-nj-load>${esc(tr("nj.mom.loadmore"))}` +
        (rest ? `<b>${rest > 99 ? "99+" : rest}</b>` : "") +
        `</button>`;
      moreEl.querySelector("[data-nj-load]").addEventListener("click", load);
    }

    async function load() {
      if (loading || done) return;
      loading = true;
      const my = gen;
      if (!count) moreEl.innerHTML = `<span class="nj-sr">${esc(tr("nj.loading"))}</span>`;
      try {
        const qs = new URLSearchParams();
        qs.set("limit", String(limit));
        qs.set("voter_id", state.voterId);
        if (filter.type) qs.set("type", filter.type);
        if (filter.month) qs.set("month", filter.month);
        if (filter.before) qs.set("before", filter.before);
        if (filter.location) qs.set("location", filter.location);
        if (cursor != null) qs.set("cursor", cursor);

        const d = await api("/api/moments?" + qs.toString());
        if (my !== gen || state.activeView !== "moments") return;
        const items = d.list || [];
        total = Number(d.total || 0);
        renderItems(items);
        count += items.length;
        cursor = d.nextCursor == null ? null : d.nextCursor;
        done = cursor == null;
        paintMore();
        // 锚点定位：本批含目标条则滚动过去并高亮
        if (!anchorDone) {
          const target = feedEl.querySelector(`[data-id="${anchorId}"]`);
          if (target) {
            anchorDone = true;
            setTimeout(() => {
              target.scrollIntoView({ behavior: "smooth", block: "center" });
              target.classList.add("nj-flash");
              setTimeout(() => target.classList.remove("nj-flash"), 2600);
            }, 250);
          }
        }
      } catch (e) {
        if (my !== gen || state.activeView !== "moments") return;
        moreEl.innerHTML = `<div class="nj-loadmore-err">${esc(e.message)}<button class="nj-btn" type="button" data-nj-load>${esc(tr("nj.btn.retry"))}</button></div>`;
        moreEl.querySelector("[data-nj-load]").addEventListener("click", load);
        return;
      } finally {
        if (my === gen) loading = false;
      }
      // 锚点目标不在本页：自动翻下一页继续找（到底或找到为止）
      if (!anchorDone && !done) load();
    }

    function reload() {
      gen++;
      loading = false;
      cursor = null;
      done = false;
      count = 0;
      total = 0;
      monthGroups.clear();
      feedEl.innerHTML = "";
      moreEl.innerHTML = `<span class="nj-sr">${esc(tr("nj.loading"))}</span>`;
      load();
    }

    // 侧栏统计（失败则隐藏侧栏，主区占满全宽）
    try {
      stats = await api("/api/moments/stats");
      if (state.activeView !== "moments") return;
      renderSidebar();
    } catch {
      pageEl.classList.add("nj-mom-page--plain");
      sideEl.hidden = true;
    }
    load();
  }

  /* ---------- 相册 ---------- */
  async function photos() {
    state.activeView = "photos";
    markMoments(false);
    syncChrome();

    const s = state.settings || {};
    const per = 30;
    const page = Math.max(1, Number(new URLSearchParams(location.search).get("page")) || 1);
    setSeo({
      title: tr("nj.title.photos") + " · " + (s.site_title || "Nooj Log"),
      description: tr("nj.photos.desc"),
      path: page > 1 ? "/photos?page=" + page : "/photos",
    });
    // 服务端已直出首屏时不再先刷骨架屏，避免闪一下再被接口数据替换
    if (!app.querySelector(".nj-wrap")) app.innerHTML = skeleton(tr("nj.loading.photos"));

    let list = [];
    let total = 0;
    try {
      const d = await api("/api/photos?page=" + page + "&per_page=" + per);
      if (state.activeView !== "photos") return;
      list = d.list || [];
      total = Number(d.total || list.length);
    } catch (e) {
      if (state.activeView !== "photos") return;
      app.innerHTML = errBox(e.message);
      return;
    }
    const pages = Math.max(1, Math.ceil(total / per));
    const items = list
      .map(p => {
        const ts = thumbSrc(p.src);
        const orig = fullSrc(p.src);
        return `<a class="nj-photo" data-lightbox="${esc(orig)}" rel="external nofollow noreferrer">
          <img src="${esc(ts)}" alt="${esc(p.title || "")}" loading="lazy" referrerpolicy="no-referrer"${
            ts !== orig ? ` data-orig="${esc(orig)}"` : ""
          } />
          ${p.title ? `<span class="nj-photo-cap">${esc(p.title)}</span>` : ""}
        </a>`;
      })
      .join("");

    app.innerHTML = `<div class="nj-wrap">
      ${pageHead("GALLERY", tr("nj.ph.photos"), tr("nj.ph.photos_sub", { n: total }))}
      ${list.length ? `<div class="nj-gallery">${items}</div>` : emptyBox(tr("nj.empty.photos"), tr("nj.empty.photos_sub"))}
      ${pagerHtml(page, pages)}
    </div>`;
    app.querySelectorAll("[data-pager]").forEach(btn =>
      btn.addEventListener("click", () => {
        const next = btn.dataset.pager === "prev" ? page - 1 : page + 1;
        navigate(next <= 1 ? "/photos" : "/photos?page=" + next);
        window.scrollTo({ top: 0 });
      })
    );
  }

  /* ---------- 友链 ---------- */
  async function links() {
    state.activeView = "links";
    markMoments(false);
    syncChrome();

    const s = state.settings || {};
    const activeCat = new URLSearchParams(location.search).get("category") || "全部";
    if (!app.querySelector(".nj-wrap")) app.innerHTML = skeleton(tr("nj.loading.links"));

    let list = [];
    let stats = {};
    let categories = [];
    try {
      if (s.links_enabled === false) throw new Error(tr("nj.links.disabled"));
      const res = await api("/api/friends?category=" + encodeURIComponent(activeCat));
      if (state.activeView !== "links") return;
      list = res.list || [];
      stats = res.stats || {};
      categories = res.categories || [];
    } catch (e) {
      if (state.activeView !== "links") return;
      app.innerHTML = errBox(e.message);
      return;
    }

    const cats = ["全部"].concat(categories);
    const catHtml = cats
      .map(c => {
        const isAll = c === "全部";
        const href = isAll ? "/links" : "/links?category=" + encodeURIComponent(c);
        return `<a class="nj-chip${c === activeCat ? " is-active" : ""}" href="${href}">${esc(isAll ? tr("nj.chip.all") : c)}</a>`;
      })
      .join("");

    const cards = list
      .map(f => {
        return `<a class="nj-link-card" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer nofollow">
          <span class="nj-link-head">
            <span class="nj-link-avatar">${friendAvatar(f.name, f.avatar)}</span>
            <span class="nj-link-id">
              <span class="nj-link-name">${esc(f.name)}</span>
              <span class="nj-link-domain">${esc(domainOf(f.url))}</span>
            </span>
            <span class="nj-link-arrow">${icon("arrow", 15)}</span>
          </span>
          <span class="nj-link-desc">${esc(f.description || tr("nj.links.lazy"))}</span>
          ${friendLastPostHtml(f)}
        </a>`;
      })
      .join("");

    setSeo({
      title: tr("nj.title.links") + " · " + (s.site_title || "Nooj Log"),
      description: s.essay_subtitle || "",
      path: activeCat === "全部" ? "/links" : "/links?category=" + encodeURIComponent(activeCat),
    });

    app.innerHTML = `<div class="nj-wrap">
      ${pageHead(
        "BLOGROLL",
        tr("nj.ph.links"),
        tr("nj.ph.links_sub", { n: Number(stats.total || list.length), n2: Number(stats.newThisMonth || 0) }),
        `<a class="nj-btn" href="/links/apply">${tr("nj.ph.apply")}</a>`
      )}
      <div class="nj-chips">${catHtml}</div>
      ${
        list.length
          ? `<div class="nj-link-grid">${cards}</div>`
          : emptyBox(tr("nj.empty.links_cat"), tr("nj.empty.links_cat_sub"), `<a class="nj-btn" href="/links/apply">${tr("nj.ph.apply")}</a>`)
      }
    </div>`;
  }

  /* ---------- 友链申请 ---------- */
  function linksApply() {
    markMoments(false);
    syncChrome();
    // 申请状态卡排在友链规则前面：由主题 CSS 将 .links-apply-grid 改为显式两列 grid，
    // DOM 顺序（本站信息 → 申请状态 → 友链规则 → 申请表单）即视觉顺序
    return M.renderLinksApply();
  }

  /* ---------- 关于 ---------- */
  async function about() {
    state.activeView = "about";
    markMoments(false);
    syncChrome();

    const s = state.settings || {};
    const name = s.author_name || s.site_title || "Nooj";
    setSeo({
      title: tr("nj.title.about") + " · " + (s.site_title || "Nooj Log"),
      description: s.about_signature || s.about_greeting_sub || s.essay_subtitle || "",
      path: "/about",
      image: s.about_avatar || s.author_avatar || s.brand_avatar || "",
    });

    app.innerHTML = skeleton(tr("nj.loading.about"));

    let recent = [];
    try {
      const d = await api("/api/posts?page=1&per_page=4");
      recent = d.list || [];
    } catch (_) {
      recent = [];
    }
    if (state.activeView !== "about") return;

    const avatar = s.about_avatar || s.author_avatar || s.brand_avatar || "";
    const letter = String(name).trim().charAt(0).toUpperCase() || "N";
    const avatarHtml = avatar
      ? `<img class="nj-about-avatar-img" src="${esc(avatar)}" alt="${esc(name)}" />`
      : `<span class="nj-about-avatar-letter">${esc(letter)}</span>`;
    const tagline = shortText(String(s.essay_tips || tr("nj.slogan")).replace(/^[^·]*·\s*/, ""), 40);
    const intro = shortText(s.about_signature || s.essay_subtitle || "", 90);

    const bioParas = String(s.about_bio || s.about_signature || "")
      .split(/\n{2,}/)
      .map(x => x.trim())
      .filter(Boolean);
    const stats = parseRows(s.about_stats || "");
    const timeline = parseRows(s.about_timeline || "");
    const contacts = parseRows(s.about_contacts || "");

    const bioCard = `<section class="nj-card nj-about-bio">
      <h2 class="nj-card-title">${tr("nj.about.me")}</h2>
      <div class="nj-about-text">${bioParas
        .map(p => `<p>${esc(p)}</p>`)
        .join("") || `<p>${esc(intro || tr("nj.about.intro_empty"))}</p>`}</div>
    </section>`;

    const timelineCard = timeline.length
      ? `<section class="nj-card nj-about-tl">
          <h2 class="nj-card-title">${tr("nj.about.timeline")}</h2>
          <div class="nj-tl">${timeline
            .map(
              r => `<div class="nj-tl-item">
                <span class="nj-tl-dot"></span>
                <div class="nj-tl-body">
                  <div class="nj-tl-year">${esc(r[0] || "")}</div>
                  <div class="nj-tl-title">${esc(r[1] || "")}</div>
                  ${r[2] ? `<div class="nj-tl-desc">${esc(r[2])}</div>` : ""}
                </div>
              </div>`
            )
            .join("")}</div>
        </section>`
      : "";

    const recentCardHtml = recent.length
      ? `<section class="nj-card nj-about-recent">
          <div class="nj-card-head">
            <h2 class="nj-card-title">${tr("nj.about.recent")}</h2>
            <a class="nj-card-more" href="/posts">${esc(tr("nj.side.all"))} →</a>
          </div>
          <div class="nj-recent">${recent
            .map(
              p => `<a class="nj-recent-item" href="/post/${encodeURIComponent(p.slug)}">
                <span class="nj-recent-date">${dateParts(p.created_at).md}</span>
                <span class="nj-recent-title">${esc(p.title)}</span>
              </a>`
            )
            .join("")}</div>
        </section>`
      : "";

    const statsCard = stats.length
      ? `<section class="nj-card">
          <h2 class="nj-card-title">${tr("nj.side.numbers")}</h2>
          <div class="nj-stat-list">${stats
            .map(
              r => `<div class="nj-stat-row">
                <span class="nj-stat-row-num">${esc(r[1] || "")}</span>
                <span class="nj-stat-row-main">
                  <span class="nj-stat-row-label">${esc(r[0] || "")}</span>
                  ${r[2] ? `<span class="nj-stat-row-desc">${esc(r[2])}</span>` : ""}
                </span>
              </div>`
            )
            .join("")}</div>
        </section>`
      : "";

    const contactCard = contacts.length
      ? `<section class="nj-card">
          <h2 class="nj-card-title">${tr("nj.side.contact")}</h2>
          <div class="nj-contact-list">${contacts
            .map(r => {
              const [type, val, link] = r;
              const inner = `<span class="nj-contact-type">${esc(type || "")}</span><span class="nj-contact-val">${esc(val || "")}</span>`;
              return link
                ? `<a class="nj-contact-row" href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`
                : `<div class="nj-contact-row">${inner}</div>`;
            })
            .join("")}</div>
        </section>`
      : "";

    app.innerHTML = `<div class="nj-wrap nj-about">
      <header class="nj-about-head">
        <div class="nj-about-avatar">${avatarHtml}</div>
        <div class="nj-about-info">
          <h1>${esc(name)}</h1>
          <p class="nj-about-tagline">${esc(tagline)}</p>
          ${intro ? `<p class="nj-about-intro">${esc(intro)}</p>` : ""}
        </div>
      </header>
      <div class="nj-layout nj-layout--about">
        <div class="nj-main">${bioCard}${timelineCard}${recentCardHtml}</div>
        <aside class="nj-aside">${statsCard}${contactCard}</aside>
      </div>
    </div>`;
    window.scrollTo(0, 0);
  }

  /* ---------- 友圈（瀑布流） ---------- */
  /* 单张卡片：头像+名称+tag / 标题 / 摘要 / 图片（最多 3 张）/ 时间+热度+阅读原文 */
  function friendCard(f) {
    const imgs = Array.isArray(f.images) ? f.images.slice(0, 3) : [];
    const imod = imgs.length === 1 ? "single" : imgs.length === 2 ? "double" : "triple";
    const imgsHtml = imgs.length
      ? `<span class="nj-fr-card-imgs nj-fr-card-imgs--${imod} friend-imgs">${imgs
          .map(src => `<span class="nj-fr-card-img"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`)
          .join("")}</span>`
      : "";
    const clicks = Number(f.clicks || 0);
    const heatTier = clicks >= 200 ? " is-hot" : clicks >= 80 ? " is-warm" : "";
    return `<a class="nj-fr-card" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer nofollow" data-post-id="${esc(String(f.id || ""))}">
      <span class="nj-fr-card-head">
        <span class="nj-fr-card-avatar">${friendAvatar(f.friend_name, f.avatar)}</span>
        <span class="nj-fr-card-meta">
          <span class="nj-fr-card-name">${esc(f.friend_name || "")}</span>
          ${f.tag_name ? `<span class="nj-fr-card-tag">${esc(f.tag_name)}</span>` : ""}
        </span>
      </span>
      <span class="nj-fr-card-title">${esc(f.title || tr("nj.fr.untitled"))}</span>
      ${f.excerpt ? `<span class="nj-fr-card-excerpt">${esc(shortText(f.excerpt, 140))}</span>` : ""}
      ${imgsHtml}
      <span class="nj-fr-card-foot">
        <span class="nj-fr-card-time">${svgIcon("clock", 12)}${fmtDate(f.published_at || f.created_at)}</span>
        <span class="nj-fr-card-heat${heatTier}" title="热度">${svgIcon("flame", 12)}${clicks}°C</span>
        <span class="nj-fr-card-more">${esc(tr("nj.fr.readmore"))}${svgIcon("arrow-up-right", 12)}</span>
      </span>
    </a>`;
  }

  /* 瀑布流：最短列优先的绝对定位布局；图片用固定比例盒，加载完成不引发重排，
     ResizeObserver 仅兜底字体晚到 / 断点切换等高度变化 */
  const FR_GAP = 16;
  let frWallRaf = 0;
  let frWallRO = null;
  let frWallWrapRO = null;

  function layoutFrWall() {
    const wall = document.getElementById("njFrWall");
    if (!wall) return;
    const width = wall.offsetWidth;
    if (!width) return;
    const cols = width >= 1000 ? 3 : width >= 620 ? 2 : 1;
    const colW = (width - FR_GAP * (cols - 1)) / cols;
    const heights = new Array(cols).fill(0);
    Array.from(wall.children).forEach(el => {
      let col = 0;
      for (let i = 1; i < cols; i++) if (heights[i] < heights[col]) col = i;
      el.style.width = colW + "px";
      el.style.left = col * (colW + FR_GAP) + "px";
      el.style.top = heights[col] + "px";
      heights[col] += el.offsetHeight + FR_GAP;
    });
    wall.style.height = Math.max(0, Math.max.apply(null, heights) - FR_GAP) + "px";
  }

  function scheduleFrWall() {
    if (frWallRaf) return;
    frWallRaf = requestAnimationFrame(() => {
      frWallRaf = 0;
      layoutFrWall();
    });
  }

  function mountFrWall() {
    const wall = document.getElementById("njFrWall");
    if (!wall) return;
    if (typeof ResizeObserver !== "undefined") {
      if (!frWallRO) frWallRO = new ResizeObserver(scheduleFrWall);
      frWallRO.disconnect();
      Array.from(wall.children).forEach(el => frWallRO.observe(el));
      if (frWallWrapRO) frWallWrapRO.disconnect();
      let lastW = wall.offsetWidth;
      frWallWrapRO = new ResizeObserver(entries => {
        const w = entries[0] ? entries[0].contentRect.width : 0;
        if (Math.abs(w - lastW) < 1) return;
        lastW = w;
        scheduleFrWall();
      });
      frWallWrapRO.observe(wall);
    }
    layoutFrWall();
  }

  function bindFriendClicks(scope) {
    scope.querySelectorAll(".nj-fr-card[data-post-id]").forEach(a => {
      if (a.dataset.clickBound) return;
      a.dataset.clickBound = "1";
      a.addEventListener("click", () => {
        const id = a.dataset.postId;
        if (!id) return;
        const url = `/api/friends/posts/${encodeURIComponent(id)}/click`;
        try {
          if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
          fetch(url, { method: "POST", keepalive: true }).catch(() => {});
        } catch {
          /* 统计失败不影响跳转 */
        }
      });
    });
  }

  async function friends() {
    state.activeView = "friends";
    markMoments(false);
    syncChrome();

    const s = state.settings || {};
    app.innerHTML = skeleton(tr("nj.loading.friends"));
    if (s.friends_enabled === false) {
      app.innerHTML = errBox(tr("nj.friends.disabled"));
      return;
    }

    let list = [];
    let total = 0;
    let hasMore = false;
    let page = 1;
    try {
      const res = await api("/api/friends/posts?page=1");
      if (state.activeView !== "friends") return;
      list = res.list || [];
      total = Number(res.total || 0);
      hasMore = !!res.has_more;
    } catch (e) {
      if (state.activeView !== "friends") return;
      app.innerHTML = errBox(e.message);
      return;
    }

    setSeo({
      title: tr("nj.title.friends") + " · " + (s.site_title || "Nooj Log"),
      description: tr("nj.friends.desc"),
      path: "/friends",
    });

    app.innerHTML = `<div class="nj-wrap">
      ${pageHead("CIRCLE", tr("nj.ph.circle"), tr("nj.ph.circle_sub", { n: total }))}
      ${list.length ? `<div class="nj-fr-wall" id="njFrWall">${list.map(friendCard).join("")}</div>` : emptyBox(tr("nj.empty.friends"), tr("nj.empty.friends_sub"))}
      <div class="nj-loadmore" id="njFriendMore"${hasMore ? "" : " hidden"}><button class="nj-btn" type="button">${esc(tr("nj.btn.loadmore"))}</button></div>
      <span class="nj-end" id="njFriendEnd"${hasMore || !list.length ? " hidden" : ""}>${esc(tr("nj.end.friends"))}</span>
    </div>`;

    bindFriendClicks(app);
    mountFrWall();

    const moreWrap = app.querySelector("#njFriendMore");
    const moreBtn = moreWrap && moreWrap.querySelector("button");
    if (moreBtn) {
      moreBtn.addEventListener("click", async () => {
        moreBtn.disabled = true;
        moreBtn.textContent = tr("nj.loading") + "…";
        try {
          const next = page + 1;
          const res = await api("/api/friends/posts?page=" + next);
          const more = res.list || [];
          page = next;
          hasMore = !!res.has_more;
          total = Number(res.total || total);
          const holder = app.querySelector("#njFrWall");
          if (holder && more.length) {
            holder.insertAdjacentHTML("beforeend", more.map(friendCard).join(""));
            bindFriendClicks(holder);
            mountFrWall();
            list = list.concat(more);
          }
          moreWrap.hidden = !hasMore;
          const end = app.querySelector("#njFriendEnd");
          if (end) end.hidden = hasMore;
        } catch (e) {
          toast(e.message);
        } finally {
          moreBtn.disabled = false;
          moreBtn.textContent = tr("nj.btn.loadmore");
        }
      });
    }
  }

  window.THEME_VIEWS = {
    feed: feed,
    posts: posts,
    postDetail: postDetail,
    moments: moments,
    photos: photos,
    links: links,
    linksApply: linksApply,
    about: about,
    friends: friends,
  };

  installChrome();
  syncChrome();
  setTimeout(syncChrome, 400);
  setTimeout(syncChrome, 1500);
})();
