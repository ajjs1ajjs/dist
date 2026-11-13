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
  const HTML_I18N_KEYS = new Set([
    'case.ppu.list', 'case.unis.list',
    'faq.a1', 'faq.a4', 'faq.a5', 'faq.a6',
    'contact.note',
  ]);
  const interpolate = (value, el) => String(value)
    .replace(/\{year\}/g, String(new Date().getFullYear()))
    .replace(/\{name\}/g, el?.dataset?.i18nName || '');

  function applyLang(lang) {
    currentLang = lang === 'en' ? 'en' : 'uk';
    try { localStorage.setItem('site_lang', currentLang); } catch {}
    const dict = DICT();
    document.documentElement.lang = currentLang;
    const page = document.body?.dataset.page || 'site';
    const titleKey = 'meta.' + page + '.title';
    const descKey = 'meta.' + page + '.desc';
    if (dict[titleKey]) {
      document.title = page.startsWith('p-') && !String(dict[titleKey]).endsWith('· DIST')
        ? `${dict[titleKey]} · DIST`
        : dict[titleKey];
    }
    const desc = $('meta[name="description"]');
    if (desc && dict[descKey]) desc.setAttribute('content', dict[descKey]);
    const ogT = $('meta[property="og:title"]');
    if (ogT && dict[titleKey]) ogT.setAttribute('content', dict[titleKey]);
    const ogD = $('meta[property="og:description"]');
    if (ogD && dict[descKey]) ogD.setAttribute('content', dict[descKey]);

    $$('.lang [data-lang]').forEach((b) => {
      const on = b.dataset.lang === currentLang;
      b.classList.toggle('active', on);
      if (b.tagName === 'A') b.setAttribute('aria-current', on ? 'page' : 'false');
      else b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    $$('[data-i18n]').forEach((el) => {
      const k = el.dataset.i18n;
      if (dict[k] !== undefined) {
        const val = interpolate(dict[k], el);
        if (HTML_I18N_KEYS.has(k)) el.innerHTML = val;
        else el.textContent = val;
      }
    });
    $$('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split('|').forEach((spec) => {
        const [attr, k] = spec.split(':');
        if (dict[k] !== undefined) el.setAttribute(attr, interpolate(dict[k], el));
      });
    });
    $$('[data-i18n-placeholder]').forEach((el) => {
      const k = el.dataset.i18nPlaceholder;
      if (dict[k] !== undefined) el.setAttribute('placeholder', interpolate(dict[k], el));
    });
    updateResultCount();
    updateFilterCountLabels();

    const buyModal = $('#buyModal');
    if (buyModal?.open) {
      $('#buyMonth').textContent = `${fmtPrice(buyModal.dataset.month)} / ${t('buy.moSuffix')}`;
      $('#buyYear').textContent = `${fmtPrice(buyModal.dataset.year)} / ${t('buy.yrSuffix')}`;
    }
  }

  function initLang() {
    if (/^\/en(?:\/|$)/.test(location.pathname)) {
      applyLang('en');
      return;
    }
    let pref = null;
    try {
      const urlLang = new URLSearchParams(location.search).get('lang');
      pref = (urlLang === 'en' || urlLang === 'uk') ? urlLang : localStorage.getItem('site_lang');
    } catch {}
    applyLang(pref || 'uk');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.lang [data-lang]');
    if (!b) return;
    if (b.tagName === 'A') {
      try { localStorage.setItem('site_lang', b.dataset.lang); } catch {}
      return;
    }
    if (b.dataset.lang) applyLang(b.dataset.lang);
  });

  /* ---------- Mobile menu ---------- */
  const burger = $('#burger');
  const mobileMenu = $('#mobileMenu');
  if (burger && mobileMenu) {
    const setMenuOpen = (open) => {
      mobileMenu.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) mobileMenu.querySelector('a')?.focus();
    };
    burger.addEventListener('click', () => {
      setMenuOpen(!mobileMenu.classList.contains('open'));
    });
    mobileMenu.addEventListener('click', (e) => {
      if (e.target.closest('a')) setMenuOpen(false);
    });
    document.addEventListener('click', (e) => {
      if (mobileMenu.classList.contains('open') && !e.target.closest('#mobileMenu') && !e.target.closest('#burger')) {
        setMenuOpen(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
        setMenuOpen(false);
        burger.focus();
      }
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
  const productGrid = $('#productGrid');
  const cards = [...(productGrid?.querySelectorAll('.card') || [])];
  const priority = (card) => {
    const paid = card.querySelector('[data-buy]');
    if (paid) return 1000 + Number(paid.dataset.month || 0);
    return card.querySelector('a[href$="/p/games/"]') ? 1 : 0;
  };
  cards.sort((a, b) => priority(b) - priority(a)).forEach((card) => productGrid.append(card));
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
    const emptyActions = $('#emptyActions');
    if (emptyActions) emptyActions.hidden = visible > 0;
    if (searchClear) searchClear.hidden = !q;
    updateResultCount(visible);
    updateFilterCountLabels();
  }
  function updateResultCount(visible) {
    const el = $('#resultCount');
    if (!el) return;
    const n = visible ?? cards.filter((c) => !c.classList.contains('is-hidden')).length;
    el.textContent = t('prod.count').replace('{n}', String(n)).replace('{total}', String(cards.length));
  }
  function updateFilterCountLabels() {
    $$('[data-filter-count]').forEach((chip) => {
      const filter = chip.dataset.filterCount;
      const count = filter === 'all'
        ? cards.length
        : cards.filter((card) => (card.dataset.cat || '').split(/\s+/).includes(filter)).length;
      chip.textContent = t(chip.dataset.i18n).replace('{n}', String(count));
    });
  }
  function syncFilterUrl() {
    if (typeof history?.replaceState !== 'function' || !chips.length) return;
    try {
      const params = new URLSearchParams(location.search);
      if (activeFilter && activeFilter !== 'all') params.set('cat', activeFilter);
      else params.delete('cat');
      const q = (searchInput?.value || '').trim();
      if (q) params.set('q', q);
      else params.delete('q');
      const qs = params.toString();
      const next = (location.pathname || '/') + (qs ? `?${qs}` : '') + (location.hash || '');
      history.replaceState(null, '', next);
    } catch {}
  }
  function initFilterState() {
    if (!chips.length) return;
    try {
      const params = new URLSearchParams(location.search);
      const cat = params.get('cat');
      const match = cat && chips.find((c) => c.dataset.filter === cat);
      if (match) {
        chips.forEach((c) => { c.classList.toggle('active', c === match); c.setAttribute('aria-pressed', c === match ? 'true' : 'false'); });
        activeFilter = cat;
      }
      const q = params.get('q');
      if (q && searchInput) searchInput.value = q;
    } catch {}
  }
  chips.forEach((chip) => chip.addEventListener('click', () => {
    chips.forEach((c) => { c.classList.toggle('active', c === chip); c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
    activeFilter = chip.dataset.filter;
    applyFilters();
    syncFilterUrl();
  }));
  searchInput?.addEventListener('input', () => { applyFilters(); syncFilterUrl(); });
  searchClear?.addEventListener('click', () => { searchInput.value = ''; applyFilters(); syncFilterUrl(); searchInput.focus(); });
  $('#resetFilter')?.addEventListener('click', () => {
    const first = chips[0];
    if (first) first.click();
    if (searchInput) searchInput.value = '';
    applyFilters();
    syncFilterUrl();
  });

  /* ---------- Modal helpers ---------- */
  let lastFocus = null;
  function openModal(id) {
    const m = document.getElementById(id);
    if (!(m instanceof HTMLDialogElement) || m.open) return;
    lastFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    m.showModal();
    const closeBtn = m.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }
  function closeModal(m) {
    if (m instanceof HTMLDialogElement && m.open) m.close();
  }
  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close-modal]');
    if (close) { closeModal(close.closest('.modal')); return; }
    if (e.target instanceof HTMLDialogElement && e.target.classList.contains('modal')) closeModal(e.target);
  });
  $$('.modal').forEach((modal) => {
    modal.addEventListener('close', () => {
      document.body.style.overflow = '';
      if (lastFocus?.isConnected && typeof lastFocus.focus === 'function') lastFocus.focus();
    });
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
    $('#buyMonth').textContent = `${fmtPrice(month)} / ${t('buy.moSuffix')}`;
    $('#buyYear').textContent = `${fmtPrice(year)} / ${t('buy.yrSuffix')}`;
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
  let currentShotIdx = -1;
  function ensureShotNav(modalCard, total) {
    if (!modalCard || typeof document.createElement !== 'function') return;
    let prev = modalCard.querySelector('.shot-nav--prev');
    let next = modalCard.querySelector('.shot-nav--next');
    if (total > 1 && !prev) {
      prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'shot-nav shot-nav--prev';
      prev.setAttribute('aria-label', currentLang === 'en' ? 'Previous screenshot' : 'Попередній знімок');
      prev.textContent = '‹';
      next = document.createElement('button');
      next.type = 'button';
      next.className = 'shot-nav shot-nav--next';
      next.setAttribute('aria-label', currentLang === 'en' ? 'Next screenshot' : 'Наступний знімок');
      next.textContent = '›';
      modalCard.append(prev, next);
    }
    if (prev && next) {
      prev.hidden = total <= 1;
      next.hidden = total <= 1;
    }
  }
  function openShotAt(idx) {
    const shots = $$('[data-shot]');
    const img = $('#shotImg');
    if (!img || !shots.length) return;
    currentShotIdx = ((idx % shots.length) + shots.length) % shots.length;
    const b = shots[currentShotIdx];
    img.src = b.dataset.shot;
    img.alt = b.dataset.shotAlt || '';
    const modal = $('#shotModal');
    ensureShotNav(modal?.querySelector('.modal-card'), shots.length);
  }
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.shot-nav');
    if (nav) {
      openShotAt(currentShotIdx + (nav.classList.contains('shot-nav--next') ? 1 : -1));
      return;
    }
    const b = e.target.closest('[data-shot]');
    if (!b) return;
    const shots = $$('[data-shot]');
    openShotAt(Math.max(0, shots.indexOf(b)));
    openModal('shotModal');
  });
  document.addEventListener('keydown', (e) => {
    const modal = $('#shotModal');
    if (!modal?.open) return;
    const shots = $$('[data-shot]');
    if (shots.length <= 1) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); openShotAt(currentShotIdx + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); openShotAt(currentShotIdx - 1); }
  });

  /* ---------- Lead form (SITE only) ---------- */
  function leadPayload() {
    const f = $('#leadForm');
    if (!f?.lfName || !f?.lfContact || !f?.lfMsg) return null;
    const name = f.lfName.value.trim();
    const contact = f.lfContact.value.trim();
    const msg = f.lfMsg.value.trim();
    const isEn = currentLang === 'en';
    const subject = (isEn ? 'Inquiry from the website — ' : 'Заявка з сайту — ') + name;
    const body = isEn
      ? `Name: ${name}\nContact: ${contact}\n\nProject:\n${msg}`
      : `Ім'я: ${name}\nКуди відповісти: ${contact}\n\nЗадача:\n${msg}`;
    return { subject, body };
  }

  $('#leadForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = leadPayload();
    if (!payload) return;
    toast(t('toast.openMail'));
    location.href = `mailto:yaroslav.andreichuk@gmail.com?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
  });

  $('#copyLead')?.addEventListener('click', async () => {
    const payload = leadPayload();
    if (!payload) return;
    const text = `${payload.subject}\n\n${payload.body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast(t('toast.leadCopied'));
    } catch {
      toast(text);
    }
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

  /* ---------- Same-origin release manifest ---------- */
  function compareVersions(a, b) {
    const parse = (value) => {
      if (typeof value !== 'string' || !/^v?\d+(?:\.\d+)*$/i.test(value)) return null;
      return value.replace(/^v/i, '').split('.').map(Number);
    };
    const left = parse(a);
    const right = parse(b);
    if (!left || !right) return null;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff) return Math.sign(diff);
    }
    return 0;
  }

  async function syncLatestReleases() {
    const manifestUrl = document.currentScript?.src
      ? new URL('./releases.json', document.currentScript.src).href
      : '/releases.json';
    const CACHE_KEY = 'dist_latest_manifest_v1';
    let latest = null;
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached?.schemaVersion === 1 && Date.now() - cached.ts < 10 * 60 * 1000 && cached.latest && typeof cached.latest === 'object') latest = cached.latest;
    } catch {}
    if (!latest) {
      try {
        const res = await fetch(manifestUrl, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          if (data.schemaVersion === 1 && data.latest && typeof data.latest === 'object') {
            latest = data.latest;
            try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ schemaVersion: 1, ts: Date.now(), latest })); } catch {}
          }
        }
      } catch {}
    }
    if (!latest) return;
    const accepted = new Map();
    $$('[data-latest-ver]').forEach((el) => {
      const prefix = el.dataset.latestVer;
      const item = latest[prefix];
      if (!item?.version) return;
      const comparison = compareVersions(item.version, el.textContent.trim());
      if (comparison === null || comparison < 0 || accepted.get(prefix) === false) {
        accepted.set(prefix, false);
        return;
      }
      accepted.set(prefix, true);
    });
    $$('[data-latest-ver]').forEach((el) => {
      const item = latest[el.dataset.latestVer];
      if (accepted.get(el.dataset.latestVer) && item?.version) el.textContent = item.version;
    });
    $$('[data-latest-href]').forEach((el) => {
      if (accepted.get(el.dataset.latestHref) === false) return;
      const item = latest[el.dataset.latestHref];
      if (item?.downloadUrl && /^https:\/\/(?:github\.com\/ajjs1ajjs\/dist\/releases\/download\/|objects\.githubusercontent\.com\/)/.test(item.downloadUrl)) el.href = item.downloadUrl;
    });
    $$('[data-latest-code]').forEach((el) => {
      if (accepted.get(el.dataset.latestCode) === false) return;
      const item = latest[el.dataset.latestCode];
      if (item?.name) el.textContent = item.name;
    });
  }

  /* ---------- Boot ---------- */
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  initLang();
  initFilterState();
  applyFilters();
  syncLatestReleases();
})();
