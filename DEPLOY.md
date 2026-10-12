# Запуск LastSize на домашнем сервере через Cloudflare Tunnel

Схема: посетитель → Cloudflare (HTTPS, защита от атак, кэш фото) → туннель → сервер дома.
Сервер сам подключается к Cloudflare, поэтому статический IP и открытые порты на роутере не нужны.

```
Интернет ── Cloudflare ══ туннель ══ cloudflared ── Caddy ─┬─ web    (сайт)
                                                          ├─ admin  (админка)
                                                          ├─ api + worker
                                                          └─ фото (SeaweedFS)
                     Postgres, Redis, хранилище: только внутренняя сеть Docker
```

## 1. Домен

1. Купите домен. Удобнее всего `.kz` или `.com`.
   - **Про `.kz`.** По правилам зоны сайт на `.kz` должен работать на сервере в Казахстане. Ваш сервер стоит в Алматы, так что это условие выполнено. До покупки спросите регистратора (ps.kz, hoster.kz и др.), можно ли указать NS-серверы Cloudflare. Если нельзя, берите `.com`: позже можно купить и `.kz` и перенаправить его.
2. Зарегистрируйтесь на [dash.cloudflare.com](https://dash.cloudflare.com) и нажмите **Add a domain**. Тариф **Free** подходит.
3. Cloudflare покажет два NS-сервера. Пропишите их у регистратора вместо его собственных. Домен станет **Active** через срок от нескольких минут до суток. Cloudflare пришлёт письмо.

## 2. Туннель

**Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, название `lastsize`.

Cloudflare покажет команду установки с длинным токеном (`eyJ...`).

- Скопируйте **только токен**. Команду выполнять не нужно: cloudflared уже входит в наш `docker-compose`.
- Токен секретный. Храните его в менеджере паролей.

Во вкладке **Public hostnames** (или **Published application routes**) добавьте три записи. В каждой Type = `HTTP`, URL = `caddy:80`:

| Subdomain | Domain        | Service         |
| --------- | ------------- | --------------- |
| (пусто)   | `lastsize.kz` | `HTTP caddy:80` |
| `www`     | `lastsize.kz` | `HTTP caddy:80` |
| `admin`   | `lastsize.kz` | `HTTP caddy:80` |

DNS-записи для них Cloudflare создаст сам.

> **Если на сервере уже работает свой cloudflared** (например, для других сервисов), можно не заводить новый туннель. Добавьте эти три hostname в существующий туннель с сервисом `http://localhost:8080`. В `deploy/.env` тогда поставьте `COMPOSE_PROFILES=` (пусто) и не заполняйте `CLOUDFLARE_TUNNEL_TOKEN`.

## 3. Настройки Cloudflare

| Где                         | Что                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------- |
| SSL/TLS → Overview          | режим **Full**                                                                          |
| SSL/TLS → Edge Certificates | **Always Use HTTPS**: On, **Minimum TLS**: 1.2                                          |
| Caching → Cache Rules       | правило «URI Path starts with `/media/`» → **Eligible for cache**, Edge TTL: use origin |
| Caching → Configuration     | **не** включайте «Cache Everything» для всего сайта: страницы и `/api` личные           |
| Security → Bots             | Bot Fight Mode можно включить. Оформление заказа уже защищено своей проверкой (ALTCHA)  |
| Speed → Optimization        | Rocket Loader: **Off** (ломает скрипты Next.js)                                         |

**Админка за дополнительным замком (рекомендуется).**

1. Откройте **Zero Trust → Access → Applications → Add → Self-hosted**.
2. Укажите домен `admin.lastsize.kz` и создайте политику **Allow** со списком e-mail сотрудников.
3. Теперь, прежде чем откроется даже страница входа, Cloudflare попросит код из письма.

Пароль и код из приложения-аутентификатора по-прежнему нужны.

## 4. Подготовка сервера (Ubuntu)

```bash
sudo systemctl enable --now docker
sudo timedatectl set-ntp true
sudo apt install -y unattended-upgrades git
sudo git clone https://github.com/MirasAkhmetov/lastsize.git /opt/lastsize
sudo chown -R $USER /opt/lastsize
```

Сделайте также следующее:

- **BIOS.** Включите «Restore on AC power loss» = **Power On**, чтобы после отключения света сервер включался сам.
- **ИБП.** Купите на 15–30 минут работы. Это и защита базы от внезапного выключения, и время пережить короткие отключения.
- **Сон.** Убедитесь, что сервер не уходит в сон:

  ```bash
  sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
  ```

## 5. Настройки и секреты

```bash
cd /opt/lastsize/deploy
cp .env.production.example .env
chmod 600 .env
```

Сгенерируйте секреты и впишите их в `.env`. Каждую команду запускайте отдельно, у каждого секрета своё значение:

```bash
openssl rand -hex 32
```

Это значения для `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `S3_ACCESS_KEY` и `S3_SECRET_KEY`.

```bash
openssl rand -base64 32
```

Это значение для `SECRETS_ENCRYPTION_KEY`.

Дальше заполните:

- `SITE_DOMAIN` и `ADMIN_DOMAIN`: ваш домен и `admin.` + домен.
- `CLOUDFLARE_TUNNEL_TOKEN`: токен из шага 2.

**Ключи для уведомлений в браузере** (VAPID):

```bash
docker run --rm node:24-alpine npx -y web-push@3.6.7 generate-vapid-keys
```

Public Key → `VAPID_PUBLIC_KEY`, Private Key → `VAPID_PRIVATE_KEY`.

**Telegram-бот для продавцов** (уведомления о заказах и восстановление пароля):

1. Напишите [@BotFather](https://t.me/BotFather) команду `/newbot`.
2. Токен впишите в `TELEGRAM_BOT_TOKEN`, имя бота без `@` — в `TELEGRAM_BOT_USERNAME`.

Бот сам забирает сообщения у Telegram, вебхук настраивать не нужно.

> **Сохраните готовый `.env` в менеджер паролей.** Особенно важен `SECRETS_ENCRYPTION_KEY`: без него из резервной копии не восстановить коды двухфакторного входа и токены маркетплейсов. В Git этот файл не попадает.

## 6. Запуск

```bash
cd /opt/lastsize/deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Первая сборка занимает 5–10 минут. Контейнер `migrate` создаст таблицы и завершится, это нормально. Остальные сервисы должны быть `healthy`.

Проверьте с самого сервера, что всё работает. Вместо `lastsize.kz` подставьте свой домен:

```bash
curl -s -H 'Host: lastsize.kz' http://127.0.0.1:8080/api/v1/health
```

Ответ должен быть `{"status":"ok"}`. После этого откройте `https://ваш-домен` в браузере.

Если туннель не поднялся, посмотрите логи:

```bash
docker compose -f docker-compose.prod.yml logs --tail=50 cloudflared
```

В Zero Trust туннель должен быть **Healthy**.

## 7. Первый администратор

```bash
docker compose -f docker-compose.prod.yml run --rm api \
  node dist/cli/create-admin.js --phone "+7 701 123 45 67" --name "Имя"
```

Пароль вводится скрыто. Дальше:

1. Войдите на `https://admin.ваш-домен`.
2. Подключите приложение-аутентификатор: Google Authenticator, 1Password и т. п.

**Демо-данные.** Тестовые магазины и товары из разработки на сервер не попадают: база создаётся пустой. Настоящие магазины регистрируются на сайте сами. Вы подтверждаете их в админке, после звонка по номеру телефона.

## 8. Резервные копии

Скрипт `deploy/backup.sh` каждую ночь сохраняет базу данных и все фото. Копии лежат в `BACKUP_DIR` и хранятся `BACKUP_KEEP_DAYS` дней.

**Копия вне дома обязательна**: сервер может сгореть, сломаться или пропасть вместе с копиями. Самый простой вариант — **Cloudflare R2**: 10 ГБ бесплатно, аккаунт у вас уже есть.

1. Откройте **R2 → Create bucket** и создайте bucket `lastsize-backups`.
2. Откройте **R2 → Manage API tokens → Create**. Права: Object Read & Write, только для этого bucket.
3. Настройте rclone:

   ```bash
   sudo docker run --rm -it -v /root/.config/rclone:/config/rclone rclone/rclone:1.75.1 config
   ```

   На вопросы мастера ответьте так:
   - `n` (новый remote), имя `r2`;
   - Storage: `s3`, provider: `Cloudflare`;
   - введите ключи из токена;
   - endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

4. Впишите в `deploy/.env` строку `BACKUP_REMOTE=r2:lastsize-backups`.

Первый запуск и проверка восстановления:

```bash
sudo /opt/lastsize/deploy/backup.sh
sudo /opt/lastsize/deploy/restore-check.sh
```

`restore-check.sh` разворачивает последнюю копию во временной базе и показывает число магазинов, товаров, заказов и пользователей. Запускайте его раз в месяц.

Чтобы копия делалась каждую ночь в 03:15, откройте `sudo crontab -e` и добавьте строку:

```
15 3 * * * /opt/lastsize/deploy/backup.sh >> /var/log/lastsize-backup.log 2>&1
```

### Полное восстановление (новый сервер, пустые тома)

1. Повторите шаги 4–5: верните `.env` из менеджера паролей.
2. Восстановите базу и фото:

```bash
cd /opt/lastsize/deploy
docker compose -f docker-compose.prod.yml up -d postgres storage
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < /var/backups/lastsize/db/lastsize-ДАТА.dump
set -a; . ./.env; set +a
docker run --rm --network lastsize_default -v /var/backups/lastsize/photos:/backup:ro \
  -e RCLONE_CONFIG_DST_TYPE=s3 -e RCLONE_CONFIG_DST_PROVIDER=SeaweedFS \
  -e RCLONE_CONFIG_DST_ENDPOINT=http://storage:9000 \
  -e RCLONE_CONFIG_DST_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
  -e RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  rclone/rclone:1.75.1 copy /backup dst:
docker compose -f docker-compose.prod.yml up -d --build
```

Если копии остались только в R2, сначала скачайте их на сервер:

```bash
sudo docker run --rm -v /root/.config/rclone:/config/rclone \
  -v /var/backups/lastsize:/backup rclone/rclone:1.75.1 copy r2:lastsize-backups /backup
```

## 9. Мониторинг

- **[UptimeRobot](https://uptimerobot.com)** (бесплатно). Создайте монитор HTTP(s) на `https://ваш-домен/api/v1/health` с интервалом 5 минут. Уведомления можно получать в Telegram и на почту. Монитор сработает и при отключении света, и при пропаже интернета, и при падении API.
- **Cloudflare → Notifications → Add.** Включите «Tunnel Health Alert», чтобы получать письмо, когда туннель отключается.
- **Логи:**

  ```bash
  docker compose -f docker-compose.prod.yml logs -f --tail=100 api worker
  ```

  Пароли, токены и cookie в логи не попадают.

- **Место на диске.** Раз в месяц проверяйте `df -h`. Чтобы удалить старые образы после обновлений:

  ```bash
  docker image prune -f
  ```

## 10. Обновление

```bash
sudo /opt/lastsize/deploy/backup.sh
cd /opt/lastsize && git pull
cd deploy && docker compose -f docker-compose.prod.yml up -d --build
```

Миграции базы применяются автоматически. Если миграция не прошла, новая версия API не запустится, а ошибку покажет команда:

```bash
docker compose -f docker-compose.prod.yml logs migrate
```

## Что в итоге открыто наружу

Ничего, кроме исходящего соединения cloudflared к Cloudflare.

- Caddy слушает только `127.0.0.1:8080` (для проверок с самого сервера).
- База, Redis, хранилище и API доступны только во внутренней сети Docker.
- Настоящий IP посетителя Caddy берёт из заголовка `CF-Connecting-IP`. По нему работают ограничения частоты запросов и журнал аудита.
