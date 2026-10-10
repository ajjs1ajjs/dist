# sales-cron — зовнішній тригер шедулера

Cloudflare Worker, який щодня о **07:00 UTC** викликає `workflow_dispatch`
воркфлоу [`sales-scheduler.yml`](../../../.github/workflows/sales-scheduler.yml):
фетч знижок → Telegram → коміт даних → GitHub Pages.

Навіщо: GitHub `schedule` стабільно затримується на 5–8 годин (рани стартували
о 12–15 UTC замість 07:00). Воркер дає точний час; розклад у воркфлоу лишається
як страховка.

## Секрет

`GITHUB_TOKEN` — fine-grained PAT:

- Repository access: **Only select repositories → `ajjs1ajjs/dist`**
- Permissions: **Actions: Read and write** (більше нічого)

Задати (з цієї теки):

```sh
npx wrangler secret put GITHUB_TOKEN
```

або Cloudflare Dashboard → Workers & Pages → `sales-cron` →
Settings → Variables and Secrets → Add (Secret).

## Деплой / логи

```sh
npx wrangler deploy
npx wrangler tail
```

Локальний тест scheduled-хендлера:

```sh
npx wrangler dev --test-scheduled
# в іншому терміналі:
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

Після зміни секрета перезапуск не потрібен — секрети підхоплюються на
наступному запуску воркера.
