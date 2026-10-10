# sales-cron — зовнішній тригер шедулера

Cloudflare Worker, який **4 рази на добу** (06/10/14/18 UTC = 09/13/17/21 за
Києвом влітку) викликає `workflow_dispatch` воркфлоу
[`sales-scheduler.yml`](../../../.github/workflows/sales-scheduler.yml):
фетч знижок → Telegram → коміт даних → GitHub Pages.

Навіщо: GitHub `schedule` стабільно затримується на 5–8 годин (рани стартували
о 12–15 UTC замість 07:00). Воркер дає точний час; пости в Telegram виходять
лише за новими знижками (≥50%, до 10 за ран) — тож 4 рани = до 4 повідомлень
на добу. Розклад у воркфлоу лишається як страховка.

## Секрет

`GITHUB_TOKEN` — PAT з правом тригерити Actions у `ajjs1ajjs/dist`
(для класичного токена — scope `workflow`; для fine-grained — Actions: write).
Задати (з цієї теки):

```sh
gh auth token | npx wrangler secret put GITHUB_TOKEN
```

або Cloudflare Dashboard → Workers & Pages → `sales-cron` →
Settings → Variables and Secrets → Add (Secret).

## Деплой / логи

```sh
npx wrangler deploy
npx wrangler tail
```

Локальний тест scheduled-хендлера після деплою (бере справжній секрет CF):

```sh
npx wrangler dev --remote --test-scheduled
# в іншому терміналі:
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

Після зміни секрета перезапуск не потрібен — секрети підхоплюються на
наступному запуску воркера.
