# LastSize

Маркетплейс распродаж одежды и обуви в Казахстане: все распродажи магазинов в одном месте.

Спецификация продукта: [Lastsize Blueprint](https://claude.ai/artifact/6XgYfayz5mZaQvQ5nSdHDG).

## Стек

| Часть          | Технологии                                                           |
| -------------- | -------------------------------------------------------------------- |
| Сайт           | Next.js 16 (App Router), React 19, Tailwind CSS 4, next-intl (ru/kk) |
| API            | NestJS 12 на Fastify, zod                                            |
| Данные         | PostgreSQL 18, Redis 8, S3-совместимое хранилище (SeaweedFS)         |
| Инфраструктура | Docker Compose, Caddy (HTTPS), GitHub Actions                        |

## Структура

```
apps/
  api/          NestJS API (/api/v1). Единственная точка доступа к данным
  web/          Витрина на Next.js. Работает только через API
packages/
  config/       Проверка переменных окружения при старте
  contracts/    zod-схемы запросов и ответов API
  logger/       pino со скрытием секретов
deploy/         Production: docker-compose.prod.yml, Caddyfile, пример .env
```

## Запуск для разработки

Нужны Node.js 24 (`.nvmrc`) и Docker.

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm infra:up      # Postgres (порт 5433), Redis, S3
pnpm dev           # сайт: http://localhost:3000, API: http://localhost:4000/api/v1/health
```

Казахская версия сайта: http://localhost:3000/kk

## Проверки

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Интеграционные тесты API с настоящими Postgres и Redis запускаются, если заданы `TEST_DATABASE_URL` и `TEST_REDIS_URL` (в CI заданы всегда):

```bash
TEST_DATABASE_URL=postgres://lastsize:dev-only-change-me@localhost:5433/lastsize \
TEST_REDIS_URL=redis://localhost:6379 pnpm test
```

## Развёртывание на сервере

```bash
cd deploy
cp .env.production.example .env   # заполнить, секреты: openssl rand -hex 32
docker compose -f docker-compose.prod.yml up -d --build
```

Наружу открыт только Caddy (порты 80/443). API, базы и хранилище доступны только во внутренней сети Docker. До покупки домена `SITE_ADDRESS=:80`.

## Правила безопасности

- Секреты только в переменных окружения. `.env` не коммитится, в репозитории только `.env.example`.
- Сайт не обращается к базе, очередям и внешним API напрямую. ESLint запрещает такие импорты в `apps/web`.
- Логи проходят через `@lastsize/logger`: пароли, токены, cookie и заголовки авторизации заменяются на `[REDACTED]`.
- Ошибки API отдаются в формате RFC 9457 без стектрейсов и внутренних сообщений.
