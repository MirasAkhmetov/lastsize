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
  db/           Схема PostgreSQL (Drizzle), миграции, справочники, RBAC, репозитории остатков и цен
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
pnpm db:migrate    # миграции + справочники (роли, категории, размеры, цвета)
pnpm dev           # сайт: http://localhost:3000, API: http://localhost:4000/api/v1/health
```

Казахская версия сайта: http://localhost:3000/kk

## База данных

- Схема описана в `packages/db/src/schema`. После её изменения: `pnpm db:generate` создаёт SQL-миграцию в `packages/db/migrations`. Миграции коммитятся, CI проверяет, что они не отстают от схемы.
- Триггеры и функции пишутся вручную: `pnpm --filter @lastsize/db exec drizzle-kit generate --custom --name <name>`.
- Деньги хранятся целыми числами в тиынах (1 ₸ = 100 тиын).
- Остатки меняются только через `reserveStock` / `releaseStock` / `commitStock` / `returnStock` / `setStockLevel`. Каждое движение пишется в журнал `inventory_transactions`, который нельзя изменить или удалить. Ограничения в самой базе не дают зарезервировать больше, чем есть.
- Скидка (`discount_percent`) считается базой от минимальной из цен: заявленной, за 30 дней и фактической на WB/Kaspi. Каждое изменение цены триггер пишет в `price_history`.

## Вход и права доступа

- **Продавцы и сотрудники**: телефон + пароль (argon2id). Сессия хранится на сервере, в cookie только случайный токен (`__Host-sid`, HttpOnly, Secure, SameSite=Lax). Сессия продавца живёт 30 дней с продлением, сотрудника — максимум 8 часов.
- **Сотрудники (ADMIN, SUPER_ADMIN)**: после пароля обязателен код из приложения-аутентификатора (TOTP). Секрет TOTP хранится зашифрованным (AES-256-GCM, ключ `SECRETS_ENCRYPTION_KEY`), использованный код нельзя повторить.
- **Покупатели** не регистрируются: гостевая сессия создаётся при первом действии (`__Host-gsid`).
- **Доступ по умолчанию запрещён.** Любой эндпоинт требует вход, если он не помечен `@Public()`. Права проверяет сервер: `@RequirePermissions(...)` для глобальных прав, `@RequireStoreAccess(...)` для прав в конкретном магазине. Чужой магазин отвечает 404. Роли и права описаны в `packages/db/src/rbac.ts`.
- **Защита от перебора**: 5 неверных паролей на номер — блокировка на 15 минут, лимиты на IP для входа и регистрации, 5 неверных TOTP-кодов — блокировка.
- **CSRF**: изменяющие запросы с чужого `Origin` или с `Sec-Fetch-Site: cross-site` отклоняются.
- **Аудит**: входы, неудачные попытки, блокировки, выдача ролей пишутся в `audit_logs`. Запись нельзя изменить или удалить.

### Первый администратор

```bash
# локально
pnpm --filter @lastsize/api build
node --env-file=.env apps/api/dist/cli/create-admin.js --phone "+7 701 123 45 67" --name "Имя"

# на сервере
cd deploy && docker compose -f docker-compose.prod.yml run --rm api \
  node dist/cli/create-admin.js --phone "+7 701 123 45 67" --name "Имя"
```

Пароль вводится скрыто. При первом входе нужно подключить приложение-аутентификатор.

## Проверки

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Интеграционные тесты API с настоящими Postgres и Redis запускаются, если заданы `TEST_DATABASE_URL` и `TEST_REDIS_URL` (в CI заданы всегда):

```bash
TEST_DATABASE_URL=postgres://lastsize:dev-only-change-me@localhost:5433/lastsize \
TEST_REDIS_URL=redis://localhost:6379 pnpm test
```

Тесты `packages/db` создают для каждого файла отдельную временную базу, применяют миграции и удаляют её после.

## Развёртывание на сервере

```bash
cd deploy
cp .env.production.example .env   # заполнить, секреты: openssl rand -hex 32
docker compose -f docker-compose.prod.yml up -d --build
```

Перед стартом API контейнер `migrate` применяет миграции и справочники. Если миграция не прошла, API не запустится.

Наружу открыт только Caddy (порты 80/443). API, базы и хранилище доступны только во внутренней сети Docker. До покупки домена `SITE_ADDRESS=:80`.

## Правила безопасности

- Секреты только в переменных окружения. `.env` не коммитится, в репозитории только `.env.example`.
- Сайт не обращается к базе, очередям и внешним API напрямую. ESLint запрещает такие импорты в `apps/web`.
- Логи проходят через `@lastsize/logger`: пароли, токены, cookie и заголовки авторизации заменяются на `[REDACTED]`.
- Ошибки API отдаются в формате RFC 9457 без стектрейсов и внутренних сообщений.
