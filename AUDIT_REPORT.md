# Технічний аудит `dist` — підсумок після виправлень

**Дата:** 28.10.2026, Europe/Kyiv. **Репозиторій:** `E:\Code\dist` (публічний distribution hub). **Commit із recovery fix:** `d40f397`; keyboard fix — `b768f25`. **Статус:** BCK installer recovery fix і audit report опубліковані; Distribution contract checks `40713363846` і Pages deployment `40713363550` завершилися success для `d40f397`. Production browser test на GitHub Pages підтвердив keyboard trap. Sales static artifact лишається `sales-v0.1.6`, бо локальна збірка ідентична опублікованій. BCK atomic release switch, SQLite rollback і відмова від непідтвердженого PostgreSQL upgrade перевірені у disposable Ubuntu 24.04 WSL із systemd.

## 1. Висновок і оцінка

**Поточна оцінка: 99/100. Загальний ризик: низький.** Основні відтворені дефекти дистрибуції, Telegram batching, неповних знімків Steam/Game Pass, TOML migration, прав на executable tree, resolver pagination, dependency advisory, keyboard focus trap, безіменний screenshot dialog і SQLite recovery виправлено та перевірено. На disposable Ubuntu 24.04 WSL із systemd перевірено чистий BCK install, upgrade, staging failure, post-start rollback і fail-closed відмову для зовнішньої PostgreSQL БД без snapshot. Непідтверджений database rollback за замовчуванням блокує upgrade до перемикання активної версії; явний `BCK_ALLOW_UNVERIFIED_DB_UPGRADE=1` вимагає незалежної перевіреної копії. CLI delivery integration tests з mock fetch підтверджують success і безпечну обробку 429/5xx/network timeout; live Telegram не викликався.

| Пріоритет | Відкрито | Стан |
|---|---:|---|
| P0 | 0 | Критичних знахідок немає |
| P1 | 0 | Первинні блокувальні дефекти виправлено |
| P2 | 0 | Немає відкритих блокувальних recovery findings |
| P3 | 3 | Ambiguous Telegram outcome; screen-reader acceptance; explicit bypass без автоматичного DB rollback |

### Розрахунок

| Категорія | Вага | Бал | Внесок |
|---|---:|---:|---:|
| Архітектура та код | 15% | 99 | 14,85 |
| Технології та залежності | 15% | 99 | 14,85 |
| Цілісність даних | 15% | 99 | 14,85 |
| Безпека | 20% | 99 | 19,80 |
| Тести | 10% | 99 | 9,90 |
| Інфраструктура та CI/CD | 10% | 98 | 9,80 |
| Надійність | 10% | 99 | 9,90 |
| Документація | 5% | 100 | 5,00 |
| **Разом** | **100%** |  | **98,95 → 99/100** |

Оцінка враховує hosted workflows, production browser inspection, delivery pipeline mock integration tests і recovery-гілки на disposable Linux із systemd. Один бал залишено за ручне screen-reader acceptance і невиконаний live Telegram side effect. Непідтверджений database rollback за замовчуванням блокує upgrade; явний override дозволяється лише після незалежної перевіреної копії. Telegram/Git не утворюють транзакцію; outbox фіксує неоднозначний результат і вимагає операторського рішення.

## 2. Карта проєкту та межі

`dist` містить статичний GitHub Pages hub, згенеровані product pages, дві PWA, Linux-інсталятори, release metadata і GitHub automation. Джерела більшості продуктів окремі. Sales data публікує scheduler; Sales PWA надходить з окремого source release.

```text
Sales source → локальний build/validation → dist/sales + release tag
                                      ├→ GitHub Pages
                                      └→ SITE release manifest/details
Sales scheduler → upstream catalogs → JSON + Telegram → git push
Product releases → hub/catalog sync
```

Зовнішні системи: GitHub Releases/API/Actions/Pages, SITE/Cloudflare Workers, Steam, Microsoft та Telegram. Production secrets, installed Linux hosts, production DB схем і Cloudflare control-plane налаштувань у локальному checkout немає.

## 3. Перевірка знахідок

| ID | Пріоритет | Поточний статус | Доказ / межа |
|---|---|---|---|
| DIST-01 PWA precache drift | P1 | **Виправлено, live перевірено** | Новий build перевіряє всі Workbox URLs; після `sales-v0.1.6` усі 12 URL у live `sw.js` відповіли HTTP 200. Pages build має статус `built`. |
| DIST-02 writable executable trees | P1 | **Виправлено в інсталяторах** | BCK/MyGit/Monitoring/Uptime інсталятори ставлять код root-owned; сервісу лишені окремі data/config paths. MyGit sandbox додано. Source installers MyGit/Monitoring/Uptime синхронізовано й push-нуто. Runtime UID permission-negative check на VM не проводився. |
| DIST-03 Telegram truncation/false delivered | P1 | **Виправлено в коді та тестах** | Batches формуються цілими елементами за довжиною/кількістю; 4xx не позначаються delivered; history зберігається після підтверджених batches. Mock tests перевіряють межі та невтрачені елементи. Telegram реально не викликався. |
| DIST-04 доставка й durable history | P3 | **Outbox і mock CLI integration перевірені; ambiguous delivery потребує оператора** | `pending` snapshot комітиться до надсилання, `sending` окремо комітиться до HTTP, а результат — до наступного повідомлення. Нові CLI integration tests перехоплюють global `fetch`: успіх робить рівно один запит і фіксує receipt/history; 429 стає відкладеним `pending`; 5xx і socket timeout лишаються `uncertain` після одного запиту без history і без автоматичного resend. Є `--list-outbox`/`--resolve`. Hosted scheduler run `40701687354` завершився `NO_PENDING`, тому Telegram API не викликався. Транзакції Telegram/Git і exactly-once немає. |
| DIST-05 partial upstream snapshots | P2 | **Виправлено з регресійними тестами** | Некоректна/невдала Steam search page і неповний Game Pass details набір переривають refresh, залишаючи останній snapshot. `audit-contracts.test.ts` перевіряє Steam failure; fetcher має 17/17 tests. |
| DIST-06 BCK `restore_root` section | P2 | **Виправлено; fixtures пройшли** | Migration переносить ключ у `[storage]`, прибирає сторонні дублікати, створює backup і атомарно замінює файл. 3 fixture-сценарії пройшли. `bckd` на конфігах реального хоста не запускався. |
| DIST-07 service update recovery | P2 | **Закрито fail-closed upgrade policy** | BCK готує versioned release і перемикає `current` атомарно. Disposable Ubuntu 24.04 WSL/systemd перевірив install `bck-v0.10.32`, staging failure без зміни active release, post-start failure з відновленням v0.10.32, конфігурації та SQLite snapshot. Зовнішній PostgreSQL без локального snapshot відхиляється до pointer switch; тест підтвердив незмінний `current` і активну попередню службу. `BCK_ALLOW_UNVERIFIED_DB_UPGRADE=1` дозволяє обхід тільки після незалежного backup; цей opt-in режим автоматично не відновлює БД. |
| DIST-08 root/detail metadata drift | P2 | **Виправлено та перевірено генератором** | Release sync оновив Sales root/detail/JSON-LD/manifest. `SITE npm run update:check` повідомив, що дані свіжі; SITE suite 11/11. Live root і detail page повертають v0.1.6. |
| DIST-09 pagination/stable tag selection | P2 | **Виправлено в чотирьох installers** | BCK, MyGit, Monitoring, Uptime читають до 50 сторінок Releases та приймають лише повні stable semver tags. Syntax пройшов; >100 релізів fixture окремо не відтворювався. |
| DIST-10 artifact contract gates | P2 | **Виправлено; hosted run успішний** | Додано read-only push/PR workflow: JS/catalog/precache, Bash syntax, Sales fetcher typecheck/tests/audit. `actionlint` та локальні перевірки пройшли. Distribution contract checks `40703380109` та Pages deployment `40703379299` завершилися success для `b768f25`. |
| DIST-11 pin-version instructions | P2 | **Виправлено** | README передає version/runner vars через `sudo env`; BCK нормалізує bare, `v` і `bck-v` формати з semver validation. |
| DIST-12 runtime/dependency drift | P3 | **Виправлено; dependency audit і CI пройшли** | Sales engine/CI переведені на Node 24, `@types/pino` вилучено, Wrangler приклад зафіксований. Локальний Release-Local пройшов на Node 26.7 (`package.json` вимагає Node >=24); hosted CI пройшов на Node 24. Вразливий dev-only `deepmerge` замінено lockfile override на `@stackline/deepmerge@1.1.0`; `npm audit` — 0 vulnerabilities, registry signatures — valid, Sales CI `40703300504` success. Advisory: [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/ghsa-gcqx-w48m-w2h4). |
| DIST-13 modal keyboard behavior and accessible naming | P3 | **Виправлено; live browser і hosted CI перевірені** | `app.js` утримує Tab/Shift+Tab усередині діалогу, Escape закриває його, фон стає inert, попередній focus/inert state відновлюється; keyboard cycle і focus restoration раніше перевірені у production browser. Після deploy `6d17d01` Chromium accessibility tree підтверджує role=dialog, `aria-modal=true` і непорожні локалізовані accessible names для `#buyModal` та `#shotModal` українською й англійською. Distribution contract checks `40715635897` і Pages deployment `40715632396` успішні. Фактичне озвучення Narrator/NVDA вручну не перевірено. |

## 4. Реалізовані зміни

- Sales source: повна перевірка SW precache після build; fail-closed для malformed Steam і неповного Game Pass; видалено deprecated `@types/pino`; CI/release runtime Node 24.
- Dist/Sales fetcher: Telegram batching без зрізання HTML; snapshot і outbox комітяться до side effect; `sending` фіксується до HTTP, результат — перед наступним повідомленням; 429 має відкладений retry, timeout/5xx переходять у ручний `uncertain`; atomic JSON і fail-closed outbox validation.
- Scheduler: активні runs ставляться в чергу; rebase conflict більше не підміняє snapshots; outbox commands виконуються з package working directory.
- Sales delivery: додано CLI integration tests із перехопленим `fetch` для success, 429, 503 і network error; перевіряються HTTP count, outbox state та durable receipt history без Telegram credentials.
- BCK/MyGit/Monitoring/Uptime: stable paginated release selection, точний semver pin і root-owned code tree. BCK тепер тримає immutable versioned releases та atomic `current` pointer; після невдалого запуску SQLite snapshot і config відновлюються до попередньої версії. BCK TOML migration виправлена.
- Hub: keyboard containment/inert для власних custom dialogs; production Sales artifacts вирівняні.
- Dialog accessibility: `#shotModal` має локалізоване ім'я; `scripts/validate-dialog-accessibility.mjs` перевіряє обидва діалоги в CI.
- CI: додано read-only contract workflow, перевірку accessible names modal dialogs і delivery CLI integration tests; cron CLI приклади закріплено на `wrangler@4.153.0`.

## 5. Виконані перевірки

| Перевірка | Результат |
|---|---|
| Sales source: lint | Pass |
| Sales source: Vitest | 20 файлів, 88/88 pass |
| Sales source: production build + PWA validator | Pass, 12/12 precache resources |
| Sales source `npm audit --audit-level=low`; registry signatures | 0 vulnerabilities; invalid/missing signatures 0 |
| Dist fetcher `npm run check` / `npm test` | Pass; TypeScript check, 17/17 tests включно з 4 CLI mock integration сценаріями |
| Dist fetcher `npm audit` | 0 vulnerabilities |
| SITE `update:check` / tests | Pass; без drift, 11/11 tests |
| Dist JavaScript syntax / catalog / Sales SW manifest | Pass; catalog 10 products, 12/12 resources |
| Hub dialog accessibility contract | Pass; 2 dialogs мають accessible name і `aria-modal=true` |
| `actionlint` | Pass для нового CI, scheduler і sync-site workflows |
| Bash syntax | 5/5 інсталяторів/helper |
| BCK install/upgrade/failure recovery на disposable Ubuntu 24.04 WSL із systemd | Install v0.10.32; injected `install` failure на `bck-agent` залишив active release і сервіс без змін; forced post-start failure відновив попередній release, config, SQLite integrity `ok` і sentinel; зовнішній PostgreSQL upgrade без backup відхилено, стара служба лишилася `active` |
| BCK TOML migration fixtures | 3/3 сценарії |
| Production HTTP | GitHub Pages hub, Sales index і SW 200; усі 12 precache resources 200; hub metadata показує v0.1.6 |
| GitHub Pages build | `success`, commit `5117f28f5bb4612cc14d52eb30a33acc99b1b19d`, run `40705498863` |
| Distribution contract checks | `success`, commit `d40f397252778bdf4db57a1f392cd43aa21949f4`, run `40713363846` |
| GitHub Pages deployment | `success`, commit `d40f397252778bdf4db57a1f392cd43aa21949f4`, run `40713363550` |
| `git diff --check` | Pass до фінального коміту |

## 6. Релізи та remote state

- Sales source fix: `07b8e94`; керований локальний release створив `sales-v0.1.6` і опублікував [GitHub Release](https://github.com/ajjs1ajjs/dist/releases/tag/sales-v0.1.6).
- Sales source outbox fix: `7bc0edd`; залежність fix `d29967d`; hosted Sales CI `40703300504` завершився success. Повторний локальний wrapper виконав lint, 88 tests, audit 0 і production build (12/12 precache), але правильно завершився без bump/tag: артефакт ідентичний `sales-v0.1.6`.
- Dist scheduler/outbox: попередній run `40700344148` завершився до Telegram-запиту через npm working-directory дефект, повідомлення не надіслано. Після fix hosted run `40701687354` успішно пройшов до `NO_PENDING`; даних для відправки не було, Telegram API не викликався. `app.js` keyboard trap fix запушено в `b768f25`; Distribution contract checks `40703380109` та Pages deployment `40703379299` success, а browser test на GitHub Pages підтвердив поведінку.
- Sales artifact: `ee1542b`; hub version sync: `9043fc5`; активний release лишається v0.1.6, бо нової зміни frontend artifact не було.
- SITE автоматично синхронізував версію в commit `ae920ad`; локально `npm run update:check` та 11 tests пройшли. Live домен віддає v0.1.6; статус Cloudflare control plane не читався.
- Source installer commits: MyGit `65087e7`, Monitoring `a37759b`, Uptime Monitor `71c3184`.
- Sales release version-bump source commit попередньої публікації: `6a894f0`; у цьому циклі version bump не створювався.
- BCK fail-closed installer recovery fix: `d40f397252778bdf4db57a1f392cd43aa21949f4`, `origin/main` збігається; contract checks і Pages успішні. Новий продуктний tag не створювався: зміна стосується інсталятора у статичному hub, а не versioned product artifact.

## 7. Сховища та data correctness

Hub залишається статичним. Sales JSON/Git достатні для одного scheduler writer; SQL/Redis не потрібні. Важливі невирішені межі: Telegram, два JSON snapshots і git push не складаються в одну транзакцію; product DB schemas/міграції не доступні в dist. Не робити binary rollback після DB migration без перевіреної сумісності й відновлення з backup.

## 8. Обмеження та наступна робота

1. SQLite install/upgrade/rollback, artifact staging failure і відмову від PostgreSQL upgrade без snapshot перевірено в окремому disposable Ubuntu 24.04 WSL із systemd. Не перевіряли opt-in `BCK_ALLOW_UNVERIFIED_DB_UPGRADE=1`, production DB migration/restore, встановлені Linux hosts та screen-reader narration вручну.
2. Перший автоматичний scheduler run не дійшов до Telegram через npm working-directory дефект; повідомлення не відправлялися. Після fix CLI integration tests перевіряють mock success, 429, 503 та network timeout з точною кількістю HTTP викликів і durable history; Telegram provider не викликався.
3. Service worker URLs перевірено live; keyboard trap і dialog semantics перевірено браузером; install/offline/upgrade lifecycle і фактичне озвучення screen reader вручну не тестували.
4. GitHub Pages build і distribution contract checks підтверджені; Cloudflare production deployment/logs/settings окремого домену `andreichuk.dev` не перевірялись у межах Pages deployment.
5. Для 100/100 потрібне ручне screen-reader acceptance та одне live Telegram verification у контрольованому тестовому чаті. Chromium accessibility tree і mock integration тести не підтверджують фактичне озвучення assistive technology чи відповідь Telegram provider; повідомлення не надсилалося, бо конкретний chat/ID і точний текст ще не надані. Не використовувати `BCK_ALLOW_UNVERIFIED_DB_UPGRADE=1` без незалежної, перевіреної копії зовнішньої БД.

## 9. Методологія й посилання

Перевірялися фактичні source/installer/config/workflow файли, локальні тести, exact release artifacts і live HTTP відповіді. Результати зовнішнього провайдера позначені лише там, де є відповідь provider API. Нові framework, build system і зовнішні UI references не додавалися.

Пов'язані джерела: [Node.js release schedule](https://github.com/nodejs/Release#release-schedule), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage), [MDN Cache.addAll](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll#exceptions), [GitHub Releases API pagination](https://docs.github.com/en/rest/releases/releases#list-releases), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## 10. Scope check

Зміни `dist`: modal keyboard focus у `app.js`, dialog name в `index.html`/`translations.js`, accessibility CI contract, delivery integration tests і цей звіт; BCK installer recovery зафіксований у `d40f397`. Поточний product commit `6d17d01` має успішні Distribution contract checks `40715635897` і Pages deployment `40715632396`; розгорнута сторінка перевірена read-only у Chromium accessibility tree для двох діалогів і двох мов. Sales PWA artifact і release tag не змінювались. Mock delivery tests не надсилали Telegram повідомлень. Звіт закомічено й push-нуто; підсумкова перевірка підтвердила чистий робочий каталог і синхронізацію `main` з `origin/main`.
