# sales-cron — зовнішній тригер шедулера

Cloudflare Worker, який **щогодини** викликає `workflow_dispatch` воркфлоу
[`sales-scheduler.yml`](../../../.github/workflows/sales-scheduler.yml):
фетч знижок → коміт snapshot/outbox → по одному Telegram-повідомленню з Git checkpoints → GitHub Pages.

Навіщо: GitHub `schedule` стабільно затримується на 5–8 годин (рани стартували
о 12–15 UTC замість 07:00). Воркер дає точний час; пости в Telegram виходять
лише за новими знижками (≥50%, до 10 за ран) — тож частота постів = частота
хвиль нових знижок, а не один пост щогодини. Розклад у воркфлоу лишається як
страховка.

## Секрет

`GITHUB_TOKEN` — PAT з правом тригерити Actions у `ajjs1ajjs/dist`
(для класичного токена — scope `workflow`; для fine-grained — Actions: write).
Задати (з цієї теки):

```sh
gh auth token | npx wrangler@4.153.0 secret put GITHUB_TOKEN
```

або Cloudflare Dashboard → Workers & Pages → `sales-cron` →
Settings → Variables and Secrets → Add (Secret).

## Деплой / логи

```sh
npx wrangler@4.153.0 deploy
npx wrangler@4.153.0 tail
```

Локальний тест scheduled-хендлера після деплою (бере справжній секрет CF):

```sh
npx wrangler@4.153.0 dev --remote --test-scheduled
# в іншому терміналі:
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

Після зміни секрета перезапуск не потрібен — секрети підхоплюються на
наступному запуску воркера.

## Відновлення Telegram outbox

Кожне повідомлення спершу записується у `sales/data/notification-outbox.json`
зі станом `pending`; workflow окремим комітом фіксує `sending` перед HTTP
запитом, потім фіксує `delivered`, `blocked`, `pending` (для Telegram 429) або
`uncertain` (для мережевої помилки чи HTTP 5xx, які могли статися після
прийняття запиту). Старий
`sending` після перезапуску переходить у `uncertain` і автоматично не
відправляється повторно.

Перегляд черги з клону `dist`:

```sh
cd apps/sales/fetch
DEALS_DIR=../../../sales/data npm run fetch -- --list-outbox
```

Для `uncertain` перевірте канал Telegram. Якщо повідомлення присутнє,
позначте його доставленим; якщо його немає — поставте назад у чергу:

```sh
DEALS_DIR=../../../sales/data npm run fetch -- --resolve <message-id> delivered
DEALS_DIR=../../../sales/data npm run fetch -- --resolve <message-id> pending
```

Після ручного рішення закомітьте й запуште `sales/data/deals.json`,
`sales/data/notified-history.json` та `sales/data/notification-outbox.json`
одним комітом. HTTP timeout без відповіді не дозволяє довести, чи Telegram
прийняв повідомлення, тому такий стан потребує звірки з каналом.
