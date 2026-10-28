# Технічний аудит `dist` — підсумок після виправлень

**Дата:** 28.10.2026, Europe/Kyiv. **Репозиторій:** `E:\Code\dist` (публічний distribution hub). **Код commit:** `b768f25`; цей звіт — `5117f28`. **Статус:** dependency fix, фокус модального діалогу і звіт запушені; Sales CI, distribution checks і Pages успішні. Production browser test на GitHub Pages підтвердив keyboard trap. Sales static artifact лишається `sales-v0.1.6`, бо локальна збірка ідентична опублікованій. Інсталятори продуктів та відкат після DB migration не перевірені на disposable Linux VM.

## 1. Висновок і оцінка

**Поточна оцінка: 97/100. Загальний ризик: низький із залишковим recovery-ризиком.** Основні відтворені дефекти дистрибуції, Telegram batching, неповних знімків Steam/Game Pass, TOML migration, прав на executable tree, resolver pagination, dependency advisory та keyboard focus trap виправлено і перевірено доступними локальними/hosted/browser checks. Durable outbox робить неоднозначні Telegram outcomes ручними; exactly-once між Telegram і Git принципово не гарантується. Повний rollback після DB migration та installer failure injection не перевірені на disposable Linux VM, тому 100/100 не підтверджується.

| Пріоритет | Відкрито | Стан |
|---|---:|---|
| P0 | 0 | Критичних знахідок немає |
| P1 | 0 | Первинні блокувальні дефекти виправлено |
| P2 | 1 | Повний data-compatible recovery для сервісних upgrade на disposable Linux VM |
| P3 | 2 | Ambiguous Telegram outcome потребує оператора; screen-reader приймання вручну не виконувалось |

### Розрахунок

| Категорія | Вага | Бал | Внесок |
|---|---:|---:|---:|
| Архітектура та код | 15% | 98 | 14,70 |
| Технології та залежності | 15% | 99 | 14,85 |
| Цілісність даних | 15% | 96 | 14,40 |
| Безпека | 20% | 99 | 19,80 |
| Тести | 10% | 97 | 9,70 |
| Інфраструктура та CI/CD | 10% | 96 | 9,60 |
| Надійність | 10% | 95 | 9,50 |
| Документація | 5% | 96 | 4,80 |
| **Разом** | **100%** |  | **97,35 → 97/100** |

Оцінка враховує успішні hosted workflows і browser test, але залишає резерв на невиконаний Linux VM rollback/fault-injection і screen-reader acceptance. 100/100 не підтверджується: невідомо, чи безпечно відновлювати старий бінарник після частково виконаної міграції кожного продукту. Telegram/Git не утворюють транзакцію; outbox фіксує неоднозначний результат і вимагає операторського рішення.

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
| DIST-04 доставка й durable history | P3 | **Outbox реалізовано; ambiguous delivery вимагає оператора** | `pending` snapshot комітиться до надсилання, `sending` окремо комітиться до HTTP, а результат — до наступного повідомлення. Один claim виконує один HTTP-запит; лише 429 автоматично повторюється. Timeout/5xx і stale `sending` переходять у `uncertain`, без автоматичної повторної відправки; є `--list-outbox`/`--resolve`. Recovery state покритий tests. Hosted scheduler run `40701687354` успішно завершився з `NO_PENDING`, тому зовнішнє Telegram повідомлення не створювалось і не надсилалось. Транзакції Telegram/Git і exactly-once немає. |
| DIST-05 partial upstream snapshots | P2 | **Виправлено з регресійними тестами** | Некоректна/невдала Steam search page і неповний Game Pass details набір переривають refresh, залишаючи останній snapshot. `audit-contracts.test.ts` перевіряє Steam failure; fetcher має 13/13 tests. |
| DIST-06 BCK `restore_root` section | P2 | **Виправлено; fixtures пройшли** | Migration переносить ключ у `[storage]`, прибирає сторонні дублікати, створює backup і атомарно замінює файл. 3 fixture-сценарії пройшли. `bckd` на конфігах реального хоста не запускався. |
| DIST-07 service update recovery | P2 | **Відкрито: VM rollback не верифікований** | Code ownership і staged file swap покращені; BCK все ще послідовно встановлює кілька binaries/UI, а сумісність схеми БД і rollback не підтверджені. Перед автоматичним rollback потрібні source migration contract і disposable Linux VM з копією даних. |
| DIST-08 root/detail metadata drift | P2 | **Виправлено та перевірено генератором** | Release sync оновив Sales root/detail/JSON-LD/manifest. `SITE npm run update:check` повідомив, що дані свіжі; SITE suite 11/11. Live root і detail page повертають v0.1.6. |
| DIST-09 pagination/stable tag selection | P2 | **Виправлено в чотирьох installers** | BCK, MyGit, Monitoring, Uptime читають до 50 сторінок Releases та приймають лише повні stable semver tags. Syntax пройшов; >100 релізів fixture окремо не відтворювався. |
| DIST-10 artifact contract gates | P2 | **Виправлено; hosted run успішний** | Додано read-only push/PR workflow: JS/catalog/precache, Bash syntax, Sales fetcher typecheck/tests/audit. `actionlint` та локальні перевірки пройшли. Distribution contract checks `40703380109` та Pages deployment `40703379299` завершилися success для `b768f25`. |
| DIST-11 pin-version instructions | P2 | **Виправлено** | README передає version/runner vars через `sudo env`; BCK нормалізує bare, `v` і `bck-v` формати з semver validation. |
| DIST-12 runtime/dependency drift | P3 | **Виправлено; dependency audit і CI пройшли** | Sales engine/CI переведені на Node 24, `@types/pino` вилучено, Wrangler приклад зафіксований. Локальний Release-Local пройшов на Node 26.7 (`package.json` вимагає Node >=24); hosted CI пройшов на Node 24. Вразливий dev-only `deepmerge` замінено lockfile override на `@stackline/deepmerge@1.1.0`; `npm audit` — 0 vulnerabilities, registry signatures — valid, Sales CI `40703300504` success. Advisory: [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/ghsa-gcqx-w48m-w2h4). |
| DIST-13 modal keyboard behavior | P3 | **Виправлено та browser-verified** | `app.js` утримує Tab/Shift+Tab усередині діалогу, Escape закриває його, фон стає inert, попередній focus/inert state відновлюється. Browser test на [GitHub Pages](https://ajjs1ajjs.github.io/dist/) підтвердив обидва напрями циклу та повернення фокуса. Screen-reader acceptance вручну не проходив. |

## 4. Реалізовані зміни

- Sales source: повна перевірка SW precache після build; fail-closed для malformed Steam і неповного Game Pass; видалено deprecated `@types/pino`; CI/release runtime Node 24.
- Dist/Sales fetcher: Telegram batching без зрізання HTML; snapshot і outbox комітяться до side effect; `sending` фіксується до HTTP, результат — перед наступним повідомленням; 429 має відкладений retry, timeout/5xx переходять у ручний `uncertain`; atomic JSON і fail-closed outbox validation.
- Scheduler: активні runs ставляться в чергу; rebase conflict більше не підміняє snapshots; outbox commands виконуються з package working directory.
- BCK/MyGit/Monitoring/Uptime: stable paginated release selection, точний semver pin, root-owned code tree, staged file swap і rollback без запуску старого бінарника від root. BCK TOML migration виправлена.
- Hub: keyboard containment/inert для власних custom dialogs; production Sales artifacts вирівняні.
- CI: додано read-only contract workflow; cron CLI приклади закріплено на `wrangler@4.153.0`.

## 5. Виконані перевірки

| Перевірка | Результат |
|---|---|
| Sales source: lint | Pass |
| Sales source: Vitest | 20 файлів, 88/88 pass |
| Sales source: production build + PWA validator | Pass, 12/12 precache resources |
| Sales source `npm audit --audit-level=low`; registry signatures | 0 vulnerabilities; invalid/missing signatures 0 |
| Dist fetcher: TypeScript check / Node tests | Pass; 13/13 tests |
| Dist fetcher `npm audit` | 0 vulnerabilities |
| SITE `update:check` / tests | Pass; без drift, 11/11 tests |
| Dist JavaScript syntax / catalog / Sales SW manifest | Pass; catalog 10 products, 12/12 resources |
| `actionlint` | Pass для нового CI, scheduler і sync-site workflows |
| Bash syntax | 5/5 інсталяторів/helper |
| BCK TOML migration fixtures | 3/3 сценарії |
| Production HTTP | GitHub Pages hub, Sales index і SW 200; усі 12 precache resources 200; hub metadata показує v0.1.6 |
| GitHub Pages build | `success`, commit `5117f28f5bb4612cc14d52eb30a33acc99b1b19d`, run `40705498863` |
| `git diff --check` | Pass до фінального коміту |

## 6. Релізи та remote state

- Sales source fix: `07b8e94`; керований локальний release створив `sales-v0.1.6` і опублікував [GitHub Release](https://github.com/ajjs1ajjs/dist/releases/tag/sales-v0.1.6).
- Sales source outbox fix: `7bc0edd`; залежність fix `d29967d`; hosted Sales CI `40703300504` завершився success. Повторний локальний wrapper виконав lint, 88 tests, audit 0 і production build (12/12 precache), але правильно завершився без bump/tag: артефакт ідентичний `sales-v0.1.6`.
- Dist scheduler/outbox: попередній run `40700344148` завершився до Telegram-запиту через npm working-directory дефект, повідомлення не надіслано. Після fix hosted run `40701687354` успішно пройшов до `NO_PENDING`; даних для відправки не було, Telegram API не викликався. `app.js` keyboard trap fix запушено в `b768f25`; Distribution contract checks `40703380109` та Pages deployment `40703379299` success, а browser test на GitHub Pages підтвердив поведінку.
- Sales artifact: `ee1542b`; hub version sync: `9043fc5`; активний release лишається v0.1.6, бо нової зміни frontend artifact не було.
- SITE автоматично синхронізував версію в commit `ae920ad`; локально `npm run update:check` та 11 tests пройшли. Live домен віддає v0.1.6; статус Cloudflare control plane не читався.
- Source installer commits: MyGit `65087e7`, Monitoring `a37759b`, Uptime Monitor `71c3184`.
- Sales release version-bump source commit попередньої публікації: `6a894f0`; у цьому циклі version bump не створювався.
- Фінальний commit і перевірений remote стан наведені у handoff цієї роботи.

## 7. Сховища та data correctness

Hub залишається статичним. Sales JSON/Git достатні для одного scheduler writer; SQL/Redis не потрібні. Важливі невирішені межі: Telegram, два JSON snapshots і git push не складаються в одну транзакцію; product DB schemas/міграції не доступні в dist. Не робити binary rollback після DB migration без перевіреної сумісності й відновлення з backup.

## 8. Обмеження та наступна робота

1. Не запускали Linux installer на disposable VM, systemd permission-negative tests, database migration/restore/fault injection; встановлені хости не оглядалися. Доступна лише спільна WSL Ubuntu-F; Docker/Podman не встановлені, тому root installer не запускався в цій неізольованій системі. Це лишає DIST-07 відкритим.
2. Перший автоматичний scheduler run не дійшов до Telegram через npm working-directory дефект; повідомлення не відправлялися. Після fix не запускали реальне надсилання, щоб не створити публічний side effect під час перевірки.
3. Service worker URLs перевірено live, keyboard trap перевірено браузером; install/offline/upgrade lifecycle і screen reader вручну не тестували.
4. GitHub Pages build і distribution contract checks підтверджені; Cloudflare production deployment/logs/settings окремого домену `andreichuk.dev` не перевірялись у межах Pages deployment.
5. Для 100/100 треба перевірити staged upgrade і data-compatible rollback на disposable Linux VM та, за потреби, пройти screen-reader acceptance. Живий Telegram side effect не створювався, бо після fix scheduler не мав pending повідомлень.

## 9. Методологія й посилання

Перевірялися фактичні source/installer/config/workflow файли, локальні тести, exact release artifacts і live HTTP відповіді. Результати зовнішнього провайдера позначені лише там, де є відповідь provider API. Нові framework, build system і зовнішні UI references не додавалися.

Пов'язані джерела: [Node.js release schedule](https://github.com/nodejs/Release#release-schedule), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage), [MDN Cache.addAll](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll#exceptions), [GitHub Releases API pagination](https://docs.github.com/en/rest/releases/releases#list-releases), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## 10. Scope check

Зміни `dist`: modal keyboard focus в `app.js` та `AUDIT_REPORT.md`; Sales source: dependency override + lockfile у `d29967d`. Sales PWA artifact і release tag не змінювались. Scheduler не створив повідомлень, Telegram нічого не надсилав. Фінальний `git status --short` після report commit чистий.
