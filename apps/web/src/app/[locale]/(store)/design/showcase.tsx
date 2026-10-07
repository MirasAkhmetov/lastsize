'use client';

import {
  Button,
  Chip,
  Dialog,
  DiscountBadge,
  EmptyState,
  Notice,
  Pill,
  Price,
  ProductCard,
  ProductCardSkeleton,
  Sheet,
  SizeChip,
  type SizeState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
  useToast,
} from '@lastsize/ui';
import { type ReactNode, useState } from 'react';

// Example data for the showcase only; nothing here is real stock.
const SIZES: { label: string; state: SizeState }[] = [
  { label: '38', state: 'available' },
  { label: '39', state: 'available' },
  { label: '40', state: 'last' },
  { label: '41', state: 'unavailable' },
  { label: '42', state: 'available' },
];

const PHOTO_TONES = ['bg-photo-1', 'bg-photo-2', 'bg-photo-3'];

const EXAMPLE_PRODUCTS = [
  {
    brand: 'Nike',
    title: 'Air Max 270, чёрные',
    sale: 3_999_000,
    original: 5_999_000,
    discount: 33,
    store: 'Sneakerhead',
    note: 'Остался 1 размер 40',
  },
  {
    brand: 'COS',
    title: 'Тренч прямого кроя',
    sale: 3_149_000,
    original: 6_999_000,
    discount: 55,
    store: 'Room 21',
    note: undefined,
  },
  {
    brand: 'Nora',
    title: 'Тренч оверсайз',
    sale: 3_499_000,
    original: 6_999_000,
    discount: 50,
    store: 'Nora Showroom',
    note: 'Последний S',
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-line pt-6">
      <h2 className="font-mono text-[11px] tracking-wider text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function DesignShowcase() {
  const toast = useToast();
  const [selected, setSelected] = useState('39');
  const [chips, setChips] = useState<Record<string, boolean>>({ size: true });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="grid gap-8 py-8">
      <header className="grid gap-2">
        <h1 className="font-display text-3xl font-black tracking-tight">
          Design system <span className="text-sale">−70%</span>
        </h1>
        <p className="max-w-prose text-muted">
          Компоненты @lastsize/ui на примерах. Данные на этой странице выдуманы. Страница доступна
          только в разработке.
        </p>
      </header>

      <Section title="Кнопки">
        <div className="flex flex-wrap gap-3">
          <Button>Добавить в корзину</Button>
          <Button variant="sale">Смотреть распродажу</Button>
          <Button variant="ghost">Продать остатки</Button>
          <Button variant="text">Сбросить фильтры</Button>
          <Button disabled>Выберите размер</Button>
          <Button loading>Отправляем</Button>
        </div>
      </Section>

      <Section title="Поля ввода">
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            label="Телефон"
            type="tel"
            defaultValue="+7 701 123 45 67"
            hint="Магазин позвонит на этот номер"
          />
          <TextField
            label="Цена продажи"
            defaultValue="59 990"
            error="Цена продажи должна быть ниже цены до скидки"
          />
          <TextField label="Имя" placeholder="Айгерим" />
        </div>
      </Section>

      <Section title="Скидка, бейджи, статусы">
        <div className="flex flex-wrap items-center gap-2">
          <DiscountBadge percent={33} />
          <Pill tone="sale">Последний размер</Pill>
          <Pill tone="ok">✓ Проверенная скидка</Pill>
          <Pill tone="ok">Самовывоз сегодня</Pill>
          <Pill tone="warn">Доставка оплачивается отдельно</Pill>
          <Pill tone="info">CONFIRMED</Pill>
          <Pill>Реклама</Pill>
        </div>
        <Price salePrice={3_999_000} originalPrice={5_999_000} size="lg" />
      </Section>

      <Section title="Размеры и фильтры">
        <div className="flex flex-wrap gap-2">
          {SIZES.map((size) => (
            <SizeChip
              key={size.label}
              label={size.label}
              state={size.state}
              selected={selected === size.label}
              onClick={() => setSelected(size.label)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ['size', 'Мой размер · 39'],
            ['discount', '−50% и больше'],
            ['pickup', 'Самовывоз сегодня'],
          ].map(([key, label]) => (
            <Chip
              key={key}
              active={chips[key!] ?? false}
              onClick={() => setChips((c) => ({ ...c, [key!]: !c[key!] }))}
            >
              {label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Карточки товаров">
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4">
          {EXAMPLE_PRODUCTS.map((product, index) => (
            <ProductCard
              key={product.title}
              href="#"
              brand={product.brand}
              title={product.title}
              salePrice={product.sale}
              originalPrice={product.original}
              discountPercent={product.discount}
              sizes={SIZES.map((size) => ({
                label: size.label,
                available: size.state !== 'unavailable',
              }))}
              highlightSize="39"
              scarcityNote={product.note}
              storeName={product.store}
              city="Алматы"
              image={<div className={`size-full ${PHOTO_TONES[index]}`} />}
            />
          ))}
          <ProductCardSkeleton />
        </div>
      </Section>

      <Section title="Вкладки, шторка, окно, уведомление">
        <Tabs defaultValue="new">
          <TabsList>
            <TabsTrigger value="new">Новые · 3</TabsTrigger>
            <TabsTrigger value="progress">В работе</TabsTrigger>
            <TabsTrigger value="done">Завершены</TabsTrigger>
          </TabsList>
          <TabsContent value="new" className="py-3 text-sm text-muted">
            Здесь будет список новых заказов.
          </TabsContent>
          <TabsContent value="progress" className="py-3 text-sm text-muted">
            Заказы, которые магазин подтвердил.
          </TabsContent>
          <TabsContent value="done" className="py-3 text-sm text-muted">
            Выданные и доставленные заказы.
          </TabsContent>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setSheetOpen(true)}>
            Фильтры
          </Button>
          <Button variant="ghost" onClick={() => setDialogOpen(true)}>
            Отменить заказ
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast({
                title: 'Новый заказ #10231',
                description: 'Nike Air Max 270 · 42 · 39 990 ₸ · Самовывоз',
                action: { label: 'Открыть', onClick: () => undefined },
              })
            }
          >
            Показать уведомление
          </Button>
        </div>
        <Notice>Доставка оплачивается курьеру отдельно и не входит в сумму заказа.</Notice>
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title="Фильтры"
          footer={
            <Button block onClick={() => setSheetOpen(false)}>
              Показать 37 товаров
            </Button>
          }
        >
          <div className="grid gap-4">
            <p className="text-[13px] font-semibold">Размер (EU)</p>
            <div className="flex flex-wrap gap-1.5">
              {SIZES.map((size) => (
                <SizeChip key={size.label} label={size.label} state={size.state} />
              ))}
            </div>
          </div>
        </Sheet>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Отменить заказ?"
          description="Резерв товаров снимется, покупатель получит уведомление."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Не отменять
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Отменить заказ</Button>
            </>
          }
        >
          {null}
        </Dialog>
      </Section>

      <Section title="Пустые состояния">
        <div className="grid gap-3 md:grid-cols-3">
          <EmptyState
            icon="0"
            title="Нет товаров в вашем размере"
            description="Уберите фильтр размера или подпишитесь на появление."
          />
          <EmptyState
            icon="♡"
            title="В избранном пока пусто"
            description="Нажмите на сердце на карточке товара."
          />
          <EmptyState
            icon="!"
            title="Синхронизация с WB не прошла"
            description="Wildberries отклонил токен. Вставьте новый токен."
            action={<Button size="sm">Обновить токен</Button>}
          />
        </div>
      </Section>
    </div>
  );
}
