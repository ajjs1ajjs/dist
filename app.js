/* ==========================================================================
   andreichuk.dev / DIST hub — shared UI script (vanilla, no dependencies)
   Один файл для двох сайтів: мова, фільтри, пошук, копіювання, модалки,
   оновлення версій з GitHub Releases, scrollspy, «догори».
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  /* ---------- Toast ---------- */
  const toastEl = $('#toast');
  let toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /* ---------- i18n ---------- */
  let currentLang = 'uk';
  const DICT = () => window.SITE_I18N?.[currentLang] || window.SITE_I18N?.uk || {};
  const t = (k) => DICT()[k] ?? window.SITE_I18N?.uk?.[k] ?? '';

  function applyLang(lang) {
    currentLang = lang === 'en' ? 'en' : 'uk';
    try { localStorage.setItem('site_lang', currentLang); } catch {}
    const dict = DICT();
    document.documentElement.lang = currentLang;
    const page = document.body?.dataset.page || 'site';
    const titleKey = 'meta.' + page + '.title';
    const descKey = 'meta.' + page + '.desc';
    if (dict[titleKey]) document.title = dict[titleKey];
    const desc = $('meta[name="description"]');
    if (desc && dict[descKey]) desc.setAttribute('content', dict[descKey]);
    const ogT = $('meta[property="og:title"]');
    if (ogT && dict[titleKey]) ogT.setAttribute('content', dict[titleKey]);
    const ogD = $('meta[property="og:description"]');
    if (ogD && dict[descKey]) ogD.setAttribute('content', dict[descKey]);

    $$('.lang button').forEach((b) => {
      const on = b.dataset.lang === currentLang;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    $$('[data-i18n]').forEach((el) => {
      const k = el.dataset.i18n;
      if (dict[k] !== undefined) {
        el.innerHTML = dict[k].replace('{year}', String(new Date().getFullYear()));
      }
    });
    $$('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split('|').forEach((spec) => {
        const [attr, k] = spec.split(':');
        if (dict[k] !== undefined) el.setAttribute(attr, dict[k]);
      });
    });
    $$('[data-i18n-placeholder]').forEach((el) => {
      const k = el.dataset.i18nPlaceholder;
      if (dict[k] !== undefined) el.setAttribute('placeholder', dict[k]);
    });
    updateResultCount();

    const buyModal = $('#buyModal');
    if (buyModal && !buyModal.hidden) {
      $('#buyMonth').textContent = fmtPrice(buyModal.dataset.month);
      $('#buyYear').textContent = fmtPrice(buyModal.dataset.year);
    }
  }

  function initLang() {
    let pref = null;
    try {
      const urlLang = new URLSearchParams(location.search).get('lang');
      pref = (urlLang === 'en' || urlLang === 'uk') ? urlLang : localStorage.getItem('site_lang');
    } catch {}
    applyLang(pref || 'uk');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.lang button');
    if (b && b.dataset.lang) applyLang(b.dataset.lang);
  });

  /* ---------- Mobile menu ---------- */
  const burger = $('#burger');
  const mobileMenu = $('#mobileMenu');
  if (burger && mobileMenu) {
    burger.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mobileMenu.addEventListener('click', (e) => {
      if (e.target.closest('a')) mobileMenu.classList.remove('open');
    });
  }

  /* ---------- Scrollspy ---------- */
  const spyLinks = $$('.nav-links a[href^="#"]');
  const spySections = $$('main section[id]');
  if (spySections.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const link = spyLinks.find((a) => a.getAttribute('href') === '#' + en.target.id);
        spyLinks.forEach((a) => a.classList.toggle('active', a === link));
      });
    }, { rootMargin: '-50% 0px -49% 0px' });
    spySections.forEach((s) => io.observe(s));
  }

  /* ---------- To top ---------- */
  const toTop = $('#toTop');
  const headEl = $('.site-head');
  addEventListener('scroll', () => {
    if (toTop) toTop.classList.toggle('show', scrollY > 640);
    if (headEl) headEl.classList.toggle('is-scrolled', scrollY > 8);
  }, { passive: true });
  if (toTop) {
    toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }

  /* ---------- Screenshot states: skeleton → loaded / broken ---------- */
  $$('.card-shot img').forEach((img) => {
    const wrap = img.closest('.card-shot');
    if (!wrap) return;
    const loaded = () => wrap.classList.add('loaded');
    if (img.complete && img.naturalWidth > 0) loaded();
    else {
      img.addEventListener('load', loaded, { once: true });
      img.addEventListener('error', () => wrap.classList.add('loaded', 'broken'), { once: true });
    }
  });

  /* ---------- Copy ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const text = b.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      toast(t('toast.cmdCopied'));
    } catch {
      toast(text);
    }
  });

  /* ---------- Filters + search ---------- */
  const cards = $$('#productGrid .card');
  const chips = $$('.chip[data-filter]');
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClear');
  const emptyMsg = $('#emptyMsg');
  let activeFilter = 'all';

  function cardText(c) {
    return (c.dataset.search || '') + ' ' + c.textContent;
  }
  function applyFilters() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    let visible = 0;
    cards.forEach((c) => {
      const cats = (c.dataset.cat || '').split(/\s+/);
      const okCat = activeFilter === 'all' || cats.includes(activeFilter);
      const okQ = !q || cardText(c).toLowerCase().includes(q);
      const show = okCat && okQ;
      c.classList.toggle('is-hidden', !show);
      if (show) visible++;
    });
    if (emptyMsg) emptyMsg.hidden = visible > 0;
    if (searchClear) searchClear.hidden = !q;
    updateResultCount(visible);
  }
  function updateResultCount(visible) {
    const el = $('#resultCount');
    if (!el) return;
    const n = visible ?? cards.filter((c) => !c.classList.contains('is-hidden')).length;
    el.textContent = t('prod.count').replace('{n}', String(n)).replace('{total}', String(cards.length));
  }
  chips.forEach((chip) => chip.addEventListener('click', () => {
    chips.forEach((c) => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
    activeFilter = chip.dataset.filter;
    applyFilters();
  }));
  searchInput?.addEventListener('input', applyFilters);
  searchClear?.addEventListener('click', () => { searchInput.value = ''; applyFilters(); searchInput.focus(); });
  $('#resetFilter')?.addEventListener('click', () => {
    const first = chips[0];
    if (first) first.click();
    if (searchInput) searchInput.value = '';
    applyFilters();
  });

  /* ---------- Modal helpers ---------- */
  let lastFocus = null;
  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    lastFocus = document.activeElement;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    const closeBtn = m.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }
  function closeModal(m) {
    if (!m) return;
    m.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close-modal]');
    if (close) { closeModal(close.closest('.modal')); return; }
    if (e.target.classList?.contains('modal')) closeModal(e.target);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal:not([hidden])').forEach(closeModal);
  });

  /* ---------- Buy modal ---------- */
  const fmtNum = (n) => Number(n).toLocaleString('uk-UA').replace(/\u00A0/g, ' ');
  const fmtPrice = (n) => (n ? fmtNum(n) + ' ₴' : '—');
  const MONO_JAR = 'https://send.monobank.ua/jar/89iqM1LmXv';
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    e.preventDefault();
    const modal = $('#buyModal');
    if (!modal) return;
    const name = b.dataset.name || '';
    const month = b.dataset.month || '';
    const year = b.dataset.year || '';
    modal.dataset.month = month;
    modal.dataset.year = year;
    $('#buyName').textContent = name;
    $('#buyMonth').textContent = fmtPrice(month) + ' / ' + t('buy.moSuffix');
    $('#buyYear').textContent = fmtPrice(year) + ' / ' + t('buy.yrSuffix');
    // Клік на суму → банка Monobank із підставленою сумою (?amount=)
    const monthLink = $('#buyMonthLink');
    const yearLink = $('#buyYearLink');
    if (monthLink) monthLink.href = month ? `${MONO_JAR}?amount=${month}` : MONO_JAR;
    if (yearLink) yearLink.href = year ? `${MONO_JAR}?amount=${year}` : MONO_JAR;
    const mail = $('#buyEmail');
    if (mail) {
      const subj = (currentLang === 'en' ? 'License — ' : 'Ліцензія — ') + name;
      const body = (currentLang === 'en'
        ? `Hello! I want to buy a license for ${name}.\nPlan: monthly/yearly.\n`
        : `Вітаю! Хочу придбати ліцензію на ${name}.\nПлан: місяць / рік.\n`);
      mail.href = 'mailto:yaroslav.andreichuk@gmail.com?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
    }
    openModal('buyModal');
  });

  /* ---------- Lightbox ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shot]');
    if (!b) return;
    const img = $('#shotImg');
    if (!img) return;
    img.src = b.dataset.shot;
    img.alt = b.dataset.shotAlt || '';
    openModal('shotModal');
  });

  /* ---------- Lead form (SITE only) ---------- */
  $('#leadForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.lfName.value.trim();
    const contact = f.lfContact.value.trim();
    const msg = f.lfMsg.value.trim();
    const isEn = currentLang === 'en';
    const subject = encodeURIComponent((isEn ? 'Inquiry from the website — ' : 'Заявка з сайту — ') + name);
    const body = encodeURIComponent(isEn
      ? `Name: ${name}\nContact: ${contact}\n\nProject:\n${msg}`
      : `Ім'я: ${name}\nКуди відповісти: ${contact}\n\nЗадача:\n${msg}`);
    toast(t('toast.openMail'));
    location.href = `mailto:yaroslav.andreichuk@gmail.com?subject=${subject}&body=${body}`;
  });

  /* ---------- Share (SITE only) ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]');
    if (!b) return;
    const kind = b.dataset.share;
    const u = new URL(location.href);
    u.searchParams.set('utm_source', 'share');
    u.searchParams.set('utm_medium', kind);
    if (currentLang === 'en') u.searchParams.set('lang', 'en');
    const url = u.toString();
    const text = currentLang === 'en'
      ? 'Yaroslav — SRE / DevOps / Software Developer · 13 products, cases'
      : 'Ярослав — SRE / DevOps / Software Developer · 13 продуктів, кейси';
    if (kind === 'copy') {
      try { await navigator.clipboard.writeText(url); toast(t('toast.linkCopied')); } catch { toast(url); }
      return;
    }
    if (kind === 'native') {
      if (navigator.share) { try { await navigator.share({ title: document.title, text, url }); } catch {} }
      else { try { await navigator.clipboard.writeText(url); toast(t('toast.linkCopied')); } catch { toast(url); } }
      return;
    }
    const links = {
      telegram: 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text),
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
      x: 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text),
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url),
    };
    if (links[kind]) open(links[kind], '_blank', 'noopener,width=640,height=540');
  });

  /* ---------- Live GitHub releases sync ---------- */
  const LATEST_CONFIG = {
    'kubelens-v': { pattern: /setup\.exe$/i },
    'netscope-v': { pattern: /portable\.zip$/i },
    'rdm-v': { pattern: /setup\.exe$/i },
    'calculator-v': { pattern: /\.exe$/i },
    'rescalc-v': { pattern: /setup.*\.exe$/i },
    'diskcleaner-v': { pattern: /\.exe$/i },
    'bck-v': { pattern: /linux.*\.tar\.gz$/i },
    'uptime-v': { pattern: null },
    'monitoring-v': { pattern: null },
    'mygit-v': { pattern: null },
    'gym-v': { pattern: null },
    'sales-v': { pattern: null },
  };
  async function syncLatestReleases() {
    const CACHE_KEY = 'dist_releases_cache_v2';
    const CACHE_TTL = 10 * 60 * 1000;
    let releases = null;
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.ts < CACHE_TTL) releases = parsed.data;
      }
    } catch {}
    if (!releases) {
      try {
        const res = await fetch('https://api.github.com/repos/ajjs1ajjs/dist/releases?per_page=100');
        if (res.ok) {
          const data = await res.json();
          releases = data.filter((r) => !r.draft && !r.prerelease);
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: releases })); } catch {}
        }
      } catch {}
    }
    if (!releases || !releases.length) return;

    const latest = {};
    const nums = (s) => s.split('.').map((n) => parseInt(n, 10) || 0);
    const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
    for (const rel of releases) {
      for (const prefix of Object.keys(LATEST_CONFIG)) {
        if (!rel.tag_name?.startsWith(prefix)) continue;
        const cur = latest[prefix];
        const ver = (t2) => nums(t2.tag_name.slice(prefix.length).replace(/^v/i, ''));
        if (!cur || cmp(ver(rel), ver(cur)) > 0) latest[prefix] = rel;
      }
    }

    $$('[data-latest-ver]').forEach((el) => {
      const rel = latest[el.dataset.latestVer];
      if (rel) el.textContent = 'v' + rel.tag_name.slice(el.dataset.latestVer.length).replace(/^v/i, '');
    });
    $$('[data-latest-href]').forEach((el) => {
      const prefix = el.dataset.latestHref;
      const rel = latest[prefix];
      const cfg = LATEST_CONFIG[prefix];
      if (!rel || !cfg?.pattern || !rel.assets) return;
      const asset = rel.assets.find((a) => cfg.pattern.test(a.name));
      // S5: підставляємо тільки лінки на наші релізи dist
      if (asset?.browser_download_url && /^https:\/\/(github\.com\/ajjs1ajjs\/dist\/releases\/download\/|objects\.githubusercontent\.com\/)/.test(asset.browser_download_url)) {
        el.href = asset.browser_download_url;
      }
    });
    $$('[data-latest-code]').forEach((el) => {
      const prefix = el.dataset.latestCode;
      const rel = latest[prefix];
      const cfg = LATEST_CONFIG[prefix];
      if (!rel || !cfg?.pattern || !rel.assets) return;
      const asset = rel.assets.find((a) => cfg.pattern.test(a.name));
      if (asset?.name) el.textContent = asset.name;
    });
  }

  /* ---------- Boot ---------- */
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  initLang();
  applyFilters();
  syncLatestReleases();
})();
