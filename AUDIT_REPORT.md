# Технічний аудит `dist` — підсумок після виправлень

**Дата:** 28.10.2026, Europe/Kyiv. **Репозиторій:** `E:\Code\dist` (публічний distribution hub). **Базовий remote:** `main` синхронізовано до `9043fc5` перед цим фінальним комітом. **Статус:** виправлення пройшли локальні перевірки, Sales PWA `sales-v0.1.6` опублікована, GitHub Pages побудував commit `9043fc5`. Зміни інсталяторів також відправлені до відповідних source-репозиторіїв.

## 1. Висновок і оцінка

**Поточна оцінка: 90/100. Загальний ризик: помірний.** Основні відтворені дефекти дистрибуції, Telegram batching, неповних знімків Steam/Game Pass, TOML migration, прав на executable tree, resolver pagination та перевірок виправлено. Оцінка не дорівнює сертифікації встановлених серверів: інсталяцію і невдалий upgrade на VM не запускали.

| Пріоритет | Відкрито | Стан |
|---|---:|---|
| P0 | 0 | Критичних знахідок немає |
| P1 | 0 | Первинні блокувальні дефекти виправлено |
| P2 | 2 | Міжсистемне вікно доставки; повний data-compatible recovery для сервісних upgrade |
| P3 | 2 | Транзитивні low advisories/toolchain validation; ручне browser/screen-reader приймання |

### Розрахунок

| Категорія | Вага | Бал | Внесок |
|---|---:|---:|---:|
| Архітектура та код | 15% | 91 | 13,65 |
| Технології та залежності | 15% | 88 | 13,20 |
| Цілісність даних | 15% | 84 | 12,60 |
| Безпека | 20% | 94 | 18,80 |
| Тести | 10% | 90 | 9,00 |
| Інфраструктура та CI/CD | 10% | 90 | 9,00 |
| Надійність | 10% | 87 | 8,70 |
| Документація | 5% | 96 | 4,80 |
| **Разом** | **100%** |  | **89,75 → 90/100** |

Бали залишають резерв на неперевірену поведінку на Linux VM/browser/Cloudflare та два залишкові P2. Значення не підвищене до 100: Telegram API і git push не утворюють транзакцію, а сумісність rollback із реальною схемою БД продуктів не доступна з цього artifact hub.

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
| DIST-04 доставка й durable history | P2 | **Частково виправлено; залишок відкритий** | Scheduler більше не скасовує активний run; rebase conflict завершується fail без whole-file `--theirs`. History атомарно зберігається після кожного підтвердженого batch. Вікно між прийняттям повідомлення Telegram і успішним записом/push лишається: повторне повідомлення можливе. `deals.json` та `notified-history.json` — окремі атомарні файли, не одна транзакція. Exactly-once не гарантується. |
| DIST-05 partial upstream snapshots | P2 | **Виправлено з регресійними тестами** | Некоректна/невдала Steam search page і неповний Game Pass details набір переривають refresh, залишаючи останній snapshot. `audit-contracts.test.ts` перевіряє Steam failure; fetcher має 8/8 tests. |
| DIST-06 BCK `restore_root` section | P2 | **Виправлено; fixtures пройшли** | Migration переносить ключ у `[storage]`, прибирає сторонні дублікати, створює backup і атомарно замінює файл. 3 fixture-сценарії пройшли. `bckd` на конфігах реального хоста не запускався. |
| DIST-07 service update recovery | P2 | **Відкрито** | Code ownership і atomic binary swap покращені; BCK все ще послідовно встановлює кілька binaries/UI, а сумісність схеми БД і rollback не підтверджені. Перед автоматичним rollback потрібні source migration contract і disposable Linux VM з копією даних. |
| DIST-08 root/detail metadata drift | P2 | **Виправлено та перевірено генератором** | Release sync оновив Sales root/detail/JSON-LD/manifest. `SITE npm run update:check` повідомив, що дані свіжі; SITE suite 11/11. Live root і detail page повертають v0.1.6. |
| DIST-09 pagination/stable tag selection | P2 | **Виправлено в чотирьох installers** | BCK, MyGit, Monitoring, Uptime читають до 50 сторінок Releases та приймають лише повні stable semver tags. Syntax пройшов; >100 релізів fixture окремо не відтворювався. |
| DIST-10 artifact contract gates | P2 | **Переважно виправлено** | Додано read-only push/PR workflow: JS/catalog/precache, Bash syntax, Sales fetcher typecheck/tests/audit. `actionlint` та еквівалентні локальні перевірки пройшли. Hosted run нового workflow після фінального commit перевірити окремо. |
| DIST-11 pin-version instructions | P2 | **Виправлено** | README передає version/runner vars через `sudo env`; BCK нормалізує bare, `v` і `bck-v` формати з semver validation. |
| DIST-12 runtime/dependency drift | P3 | **Частково виправлено** | Sales engine/CI переведені на Node 24, `@types/pino` вилучено, Wrangler приклад зафіксований. Source Release-Local пройшов локально на Node 26.7, а не на Node 24. `npm audit` у Sales source повідомив 4 low advisories у dev-only Workbox → `@rollup/plugin-node-resolve` → `deepmerge` ланцюжку; force fix пропонує несумісний downgrade, тому не застосовувався. Див. [GitHub Advisory GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). Dist fetcher audit: 0 advisories. |
| DIST-13 modal keyboard behavior | P3 | **Код виправлено; ручна перевірка відкрита** | `app.js` утримує Tab/Shift+Tab усередині діалогу, Escape закриває його, фон стає inert, попередній focus/inert state відновлюється. Browser/screen-reader acceptance вручну не проходив. |

## 4. Реалізовані зміни

- Sales source: повна перевірка SW precache після build; fail-closed для malformed Steam і неповного Game Pass; видалено deprecated `@types/pino`; CI/release runtime Node 24.
- Dist Sales fetcher: Telegram batching без зрізання HTML, failed batches лишаються pending, per-batch atomic history, atomic JSON snapshots і контракти тестів.
- Scheduler: side-effecting runs ставляться в чергу; rebase conflict більше не підміняє snapshots повністю.
- BCK/MyGit/Monitoring/Uptime: stable paginated release selection, точний semver pin, root-owned code tree, staged file swap і rollback без запуску старого бінарника від root. BCK TOML migration виправлена.
- Hub: keyboard containment/inert для власних custom dialogs; production Sales artifacts вирівняні.
- CI: додано read-only contract workflow; cron CLI приклади закріплено на `wrangler@4.153.0`.

## 5. Виконані перевірки

| Перевірка | Результат |
|---|---|
| Sales source: lint | Pass |
| Sales source: Vitest | 19 файлів, 83/83 pass |
| Sales source: production build + PWA validator | Pass, 12/12 precache resources |
| Sales source `npm audit --audit-level=high` | Exit 0; 4 low advisories залишились у dev dependency graph |
| Dist fetcher: TypeScript check / Node tests | Pass; 8/8 tests |
| Dist fetcher `npm audit` | 0 vulnerabilities |
| SITE `update:check` / tests | Pass; без drift, 11/11 tests |
| Dist JavaScript syntax / catalog / Sales SW manifest | Pass; catalog 10 products, 12/12 resources |
| `actionlint` | Pass для нового CI, scheduler і sync-site workflows |
| Bash syntax | 5/5 інсталяторів/helper |
| BCK TOML migration fixtures | 3/3 сценарії |
| Production HTTP | GitHub Pages Sales index і SW 200; усі 12 precache resources 200; `andreichuk.dev` root і Sales detail 200, показують v0.1.6 |
| GitHub Pages latest build | `built`, commit `9043fc55e3810f095798c8df32bc03a3fac6be80` |
| `git diff --check` | Pass до фінального коміту |

## 6. Релізи та remote state

- Sales source fix: `07b8e94`; керований локальний release створив `sales-v0.1.6` і опублікував [GitHub Release](https://github.com/ajjs1ajjs/dist/releases/tag/sales-v0.1.6).
- Sales artifact: `ee1542b`; hub version sync: `9043fc5`; GitHub Pages зібрав `9043fc5`.
- SITE автоматично синхронізував версію в commit `ae920ad`; локально `npm run update:check` та 11 tests пройшли. Live домен віддає v0.1.6; статус Cloudflare control plane не читався.
- Source installer commits: MyGit `65087e7`, Monitoring `a37759b`, Uptime Monitor `71c3184`.
- Sales release version-bump source commit: `6a894f0`.
- Фінальний commit і перевірений remote стан наведені у handoff цієї роботи.

## 7. Сховища та data correctness

Hub залишається статичним. Sales JSON/Git достатні для одного scheduler writer; SQL/Redis не потрібні. Важливі невирішені межі: Telegram, два JSON snapshots і git push не складаються в одну транзакцію; product DB schemas/міграції не доступні в dist. Не робити binary rollback після DB migration без перевіреної сумісності й відновлення з backup.

## 8. Обмеження та наступна робота

1. Не запускали Linux installer на disposable VM, systemd permission-negative tests, database migration/restore/fault injection; встановлені хости не оглядалися.
2. Telegram credentials і зовнішній канал не використовувались; повідомлення не відправлялися, scheduler workflow не dispatch-ився.
3. Service worker URLs перевірено live, але браузерний install/offline/upgrade lifecycle та screen reader вручну не тестували.
4. GitHub Pages build підтверджений; Cloudflare production deployment/logs/settings і hosted run нового dist CI після остаточного коміту ще не підтверджені.
5. Для прагнення до вищої оцінки: перевірити staged upgrades і data-compatible rollback у disposable VM; додати fault injection навколо Telegram send/history/push із чіткою at-least-once поведінкою; розв'язати/ізолювати dev-only deepmerge advisory без breaking dependency downgrade; перевірити keyboard trap у браузері та screen reader.

## 9. Методологія й посилання

Перевірялися фактичні source/installer/config/workflow файли, локальні тести, exact release artifacts і live HTTP відповіді. Результати зовнішнього провайдера позначені лише там, де є відповідь provider API. Нові framework, build system і зовнішні UI references не додавалися.

Пов'язані джерела: [Node.js release schedule](https://github.com/nodejs/Release#release-schedule), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage), [MDN Cache.addAll](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll#exceptions), [GitHub Releases API pagination](https://docs.github.com/en/rest/releases/releases#list-releases), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## 10. Scope check

Файли змінювалися лише в межах remediation `dist`, пов'язаних source інсталяторів, Sales source/release та SITE-версійної синхронізації. `sales/data/` новіше remote оновлення збережене. Фінальний `git status --short` наведений у коміті handoff.