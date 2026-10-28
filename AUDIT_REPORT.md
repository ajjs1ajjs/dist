# Технічний аудит `dist` — підсумок після виправлень

**Дата:** 28.10.2026, Europe/Kyiv. **Репозиторій:** `E:\Code\dist` (публічний distribution hub). **Базовий remote:** `main` синхронізовано до `17f926a` перед цим звітом. **Статус:** Sales durable outbox реалізовано і запушено; distribution checks та Pages пройшли. Актуальний static Sales artifact залишається `sales-v0.1.6`: локальний релізний скрипт зібрав PWA і не знайшов змін артефакту для нового тегу. Інсталятори продуктів і далі не перевірені на disposable Linux VM.

## 1. Висновок і оцінка

**Поточна оцінка: 92/100. Загальний ризик: помірний.** Основні відтворені дефекти дистрибуції, Telegram batching, неповних знімків Steam/Game Pass, TOML migration, прав на executable tree, resolver pagination та перевірок виправлено. Durable outbox зменшує втрату/дублювання сповіщень, але транзакція Telegram + Git принципово не забезпечується. Оцінка не є сертифікацією встановлених серверів: інсталяцію, невдалий upgrade і restore на VM не запускали.

| Пріоритет | Відкрито | Стан |
|---|---:|---|
| P0 | 0 | Критичних знахідок немає |
| P1 | 0 | Первинні блокувальні дефекти виправлено |
| P2 | 2 | Міжсистемне вікно доставки; повний data-compatible recovery для сервісних upgrade |
| P3 | 2 | Транзитивні low advisories/toolchain validation; ручне browser/screen-reader приймання |

### Розрахунок

| Категорія | Вага | Бал | Внесок |
|---|---:|---:|---:|
| Архітектура та код | 15% | 93 | 13,95 |
| Технології та залежності | 15% | 88 | 13,20 |
| Цілісність даних | 15% | 88 | 13,20 |
| Безпека | 20% | 94 | 18,80 |
| Тести | 10% | 93 | 9,30 |
| Інфраструктура та CI/CD | 10% | 92 | 9,20 |
| Надійність | 10% | 92 | 9,20 |
| Документація | 5% | 96 | 4,80 |
| **Разом** | **100%** |  | **91,65 → 92/100** |

Бали залишають резерв на неперевірену поведінку на Linux VM/browser/Cloudflare та чотири залишкові питання (два P2 і два P3). 100/100 не підтверджується: Telegram API і git push не утворюють транзакцію, сумісність rollback із реальною схемою БД продуктів не перевірена, лишилися dev-only advisories і ручне screen-reader приймання.

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
| DIST-04 доставка й durable history | P2 | **Durable outbox реалізовано; неоднозначний результат потребує оператора** | `pending` snapshot комітиться до надсилання, `sending` окремо комітиться до HTTP, а результат — до наступного повідомлення. Один claim виконує один HTTP-запит; лише 429 автоматично повторюється. Timeout/5xx і stale `sending` переходять у `uncertain`, без автоматичної повторної відправки; є `--list-outbox`/`--resolve`. Recovery state покритий tests. Hosted scheduler-run після першого push зупинився до send через неправильну npm working directory; fix запушено окремо. Живий повторний run не запускався. Транзакції Telegram/Git і exactly-once немає. |
| DIST-05 partial upstream snapshots | P2 | **Виправлено з регресійними тестами** | Некоректна/невдала Steam search page і неповний Game Pass details набір переривають refresh, залишаючи останній snapshot. `audit-contracts.test.ts` перевіряє Steam failure; fetcher має 13/13 tests. |
| DIST-06 BCK `restore_root` section | P2 | **Виправлено; fixtures пройшли** | Migration переносить ключ у `[storage]`, прибирає сторонні дублікати, створює backup і атомарно замінює файл. 3 fixture-сценарії пройшли. `bckd` на конфігах реального хоста не запускався. |
| DIST-07 service update recovery | P2 | **Відкрито** | Code ownership і atomic binary swap покращені; BCK все ще послідовно встановлює кілька binaries/UI, а сумісність схеми БД і rollback не підтверджені. Перед автоматичним rollback потрібні source migration contract і disposable Linux VM з копією даних. |
| DIST-08 root/detail metadata drift | P2 | **Виправлено та перевірено генератором** | Release sync оновив Sales root/detail/JSON-LD/manifest. `SITE npm run update:check` повідомив, що дані свіжі; SITE suite 11/11. Live root і detail page повертають v0.1.6. |
| DIST-09 pagination/stable tag selection | P2 | **Виправлено в чотирьох installers** | BCK, MyGit, Monitoring, Uptime читають до 50 сторінок Releases та приймають лише повні stable semver tags. Syntax пройшов; >100 релізів fixture окремо не відтворювався. |
| DIST-10 artifact contract gates | P2 | **Виправлено; останній hosted run успішний** | Додано read-only push/PR workflow: JS/catalog/precache, Bash syntax, Sales fetcher typecheck/tests/audit. `actionlint` та локальні перевірки пройшли. Hosted run `Distribution contract checks` для `509457d` та Pages deployment на `17f926a` завершилися success. |
| DIST-11 pin-version instructions | P2 | **Виправлено** | README передає version/runner vars через `sudo env`; BCK нормалізує bare, `v` і `bck-v` формати з semver validation. |
| DIST-12 runtime/dependency drift | P3 | **Частково виправлено** | Sales engine/CI переведені на Node 24, `@types/pino` вилучено, Wrangler приклад зафіксований. Source Release-Local пройшов локально на Node 26.7, а не на Node 24. `npm audit` у Sales source повідомив 4 low advisories у dev-only Workbox → `@rollup/plugin-node-resolve` → `deepmerge` ланцюжку; force fix пропонує несумісний downgrade, тому не застосовувався. Див. [GitHub Advisory GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). Dist fetcher audit: 0 advisories. |
| DIST-13 modal keyboard behavior | P3 | **Код виправлено; ручна перевірка відкрита** | `app.js` утримує Tab/Shift+Tab усередині діалогу, Escape закриває його, фон стає inert, попередній focus/inert state відновлюється. Browser/screen-reader acceptance вручну не проходив. |

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
| Sales source `npm audit --audit-level=high` | Exit 0; 4 low advisories залишились у dev dependency graph |
| Dist fetcher: TypeScript check / Node tests | Pass; 13/13 tests |
| Dist fetcher `npm audit` | 0 vulnerabilities |
| SITE `update:check` / tests | Pass; без drift, 11/11 tests |
| Dist JavaScript syntax / catalog / Sales SW manifest | Pass; catalog 10 products, 12/12 resources |
| `actionlint` | Pass для нового CI, scheduler і sync-site workflows |
| Bash syntax | 5/5 інсталяторів/helper |
| BCK TOML migration fixtures | 3/3 сценарії |
| Production HTTP | GitHub Pages Sales index і SW 200; усі 12 precache resources 200; `andreichuk.dev` root і Sales detail 200, показують v0.1.6 |
| GitHub Pages build | `built`, commit `17f926a779ab671b0574d227fdbb2e62fced0cb7` |
| `git diff --check` | Pass до фінального коміту |

## 6. Релізи та remote state

- Sales source fix: `07b8e94`; керований локальний release створив `sales-v0.1.6` і опублікував [GitHub Release](https://github.com/ajjs1ajjs/dist/releases/tag/sales-v0.1.6).
- Sales source outbox fix: `7bc0edd`; hosted Sales CI завершився success. Wrapper `Clone-Publish.ps1 -Repo Sales -Bump patch -Force` виконав lint, 88 tests і production build, але правильно завершився без bump/tag: статичний артефакт ідентичний v0.1.6.
- Dist scheduler/outbox commit: `509457d`; автоматичний scheduled run `40700344148` зафіксував оновлений snapshot/outbox, але завершився до Telegram-запиту через запуск npm з кореня. Після виправлення робочої теки commit `17f926a` запушено; Pages build успішний, distribution contract checks для `509457d` успішні. Повний live scheduler run ще не підтверджено.
- Sales artifact: `ee1542b`; hub version sync: `9043fc5`; активний release лишається v0.1.6, бо нової зміни frontend artifact не було.
- SITE автоматично синхронізував версію в commit `ae920ad`; локально `npm run update:check` та 11 tests пройшли. Live домен віддає v0.1.6; статус Cloudflare control plane не читався.
- Source installer commits: MyGit `65087e7`, Monitoring `a37759b`, Uptime Monitor `71c3184`.
- Sales release version-bump source commit попередньої публікації: `6a894f0`; у цьому циклі version bump не створювався.
- Фінальний commit і перевірений remote стан наведені у handoff цієї роботи.

## 7. Сховища та data correctness

Hub залишається статичним. Sales JSON/Git достатні для одного scheduler writer; SQL/Redis не потрібні. Важливі невирішені межі: Telegram, два JSON snapshots і git push не складаються в одну транзакцію; product DB schemas/міграції не доступні в dist. Не робити binary rollback після DB migration без перевіреної сумісності й відновлення з backup.

## 8. Обмеження та наступна робота

1. Не запускали Linux installer на disposable VM, systemd permission-negative tests, database migration/restore/fault injection; встановлені хости не оглядалися.
2. Перший автоматичний scheduler run не дійшов до Telegram через npm working-directory дефект; повідомлення не відправлялися. Після fix не запускали реальне надсилання, щоб не створити публічний side effect під час перевірки.
3. Service worker URLs перевірено live, але браузерний install/offline/upgrade lifecycle та screen reader вручну не тестували.
4. GitHub Pages build і distribution contract checks підтверджені; Cloudflare production deployment/logs/settings та повне hosted scheduler run після fix ще не підтверджені.
5. Для наступного підвищення оцінки: перевірити staged upgrades і data-compatible rollback у disposable VM; провести fault-injection run з тестовим Telegram destination і контрольованим Git failure; розв'язати/ізолювати dev-only deepmerge advisory без breaking downgrade; перевірити keyboard trap у браузері та screen reader.

## 9. Методологія й посилання

Перевірялися фактичні source/installer/config/workflow файли, локальні тести, exact release artifacts і live HTTP відповіді. Результати зовнішнього провайдера позначені лише там, де є відповідь provider API. Нові framework, build system і зовнішні UI references не додавалися.

Пов'язані джерела: [Node.js release schedule](https://github.com/nodejs/Release#release-schedule), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage), [MDN Cache.addAll](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll#exceptions), [GitHub Releases API pagination](https://docs.github.com/en/rest/releases/releases#list-releases), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## 10. Scope check

Файли змінювалися в `dist` (outbox/workflow/docs/report і scheduler-updated Sales snapshots) та Sales source. `sales/data/` оновлено автоматичним fetch і збережено на remote; до Telegram не надсилали. Фінальний `git status --short` перевірено перед report commit.
