// Щоденний dispatch воркфлоу sales-scheduler.yml (repo ajjs1ajjs/dist).
//
// Причина: GitHub schedule-тригери стабільно затримуються на 5–8 годин
// (рани стартували о 12–15 UTC замість 07:00) — цей воркер викликає
// workflow_dispatch рівно за cron-ом, а GitHub-розклад у самому воркфлоу
// лишається лише як страховка.
//
// Секрет GITHUB_TOKEN: fine-grained PAT, repository access = лише
// ajjs1ajjs/dist, permissions = Actions: Read and write. Більше нічого.
export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(
      'https://api.github.com/repos/ajjs1ajjs/dist/actions/workflows/sales-scheduler.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'sales-cron-worker',
        },
        body: JSON.stringify({ ref: 'main' }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`dispatch failed: ${res.status} ${body}`);
    }
    console.log('workflow_dispatch accepted');
  },

  // Смок-тест доступності воркера (секретів не торкається).
  async fetch() {
    return new Response('ok');
  },
};
