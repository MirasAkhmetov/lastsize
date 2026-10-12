/**
 * The words of every notification, in Russian and Kazakh. One source for the notification
 * centre, Telegram and browser push, so all channels say the same thing.
 */

export type Lang = 'ru' | 'kk';
type Params = Record<string, string | number | null>;
type Text = { title: string; body: string };

const money = (tiyn: unknown) =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(tiyn) / 100))} ₸`;

const CANCEL_REASONS: Record<string, Record<Lang, string>> = {
  'customer.cancelled': { ru: 'покупатель отменил заказ', kk: 'сатып алушы тапсырысты болдырмады' },
  'system.notConfirmed': {
    ru: 'магазин не подтвердил заказ за 24 часа',
    kk: 'дүкен тапсырысты 24 сағат ішінде растамады',
  },
  'system.notPickedUp': {
    ru: 'заказ не забрали за 48 часов',
    kk: 'тапсырыс 48 сағат ішінде алынбады',
  },
  'store.outOfStock': { ru: 'товара не оказалось в наличии', kk: 'тауар қолда болмады' },
  'store.customerUnreachable': { ru: 'магазин не смог дозвониться', kk: 'дүкен хабарласа алмады' },
  'store.customerRefused': { ru: 'вы отказались от заказа', kk: 'сіз тапсырыстан бас тарттыңыз' },
  'store.other': { ru: 'магазин отменил заказ', kk: 'дүкен тапсырысты болдырмады' },
};

const reason = (code: unknown, lang: Lang) =>
  typeof code === 'string' ? (CANCEL_REASONS[code]?.[lang] ?? code) : '';

const TEXTS: Record<string, (p: Params, lang: Lang) => Text> = {
  // ── to stores ──
  'order.new': (p, lang) =>
    lang === 'kk'
      ? {
          title: `Жаңа тапсырыс №${p.number}`,
          body: `${money(p.total)} · ${p.fulfillment === 'DELIVERY' ? 'курьер' : 'өзі алып кету'}. 24 сағат ішінде растаңыз.`,
        }
      : {
          title: `Новый заказ №${p.number}`,
          body: `${money(p.total)} · ${p.fulfillment === 'DELIVERY' ? 'курьер' : 'самовывоз'}. Подтвердите в течение 24 часов.`,
        },
  'order.reminder': (p, lang) =>
    lang === 'kk'
      ? {
          title: `№${p.number} тапсырыс растауды күтуде`,
          body: 'Сатып алушыға қоңырау шалып, тапсырысты растаңыз.',
        }
      : {
          title: `Заказ №${p.number} ждёт подтверждения`,
          body: 'Позвоните покупателю и подтвердите заказ.',
        },
  'order.cancelledForStore': (p, lang) =>
    lang === 'kk'
      ? {
          title: `№${p.number} тапсырыс болдырылмады`,
          body: `Себебі: ${reason(p.reason, lang)}. Тауар сатылымға қайтты.`,
        }
      : {
          title: `Заказ №${p.number} отменён`,
          body: `Причина: ${reason(p.reason, lang)}. Товар вернулся в продажу.`,
        },
  'product.removed': (p, lang) =>
    lang === 'kk'
      ? { title: 'Модератор тауарды алып тастады', body: `«${p.title}»: ${p.reason}` }
      : { title: 'Модератор снял товар', body: `«${p.title}»: ${p.reason}` },
  'store.verified': (_p, lang) =>
    lang === 'kk'
      ? { title: 'Дүкен расталды', body: 'Енді тауарларды жариялауға болады.' }
      : { title: 'Магазин подтверждён', body: 'Теперь товары можно публиковать.' },
  'store.rejected': (p, lang) =>
    lang === 'kk'
      ? { title: 'Дүкен расталмады', body: String(p.reason ?? '') }
      : { title: 'Магазин не подтверждён', body: String(p.reason ?? '') },
  'store.blocked': (p, lang) =>
    lang === 'kk'
      ? { title: 'Дүкен бұғатталды', body: String(p.reason ?? '') }
      : { title: 'Магазин заблокирован', body: String(p.reason ?? '') },
  // ── to buyers ──
  'order.confirmed': (p, lang) =>
    lang === 'kk'
      ? { title: `№${p.number} тапсырыс расталды`, body: `${p.storeName} тапсырысты растады.` }
      : { title: `Заказ №${p.number} подтверждён`, body: `${p.storeName} подтвердил заказ.` },
  'order.readyForPickup': (p, lang) =>
    lang === 'kk'
      ? {
          title: `№${p.number} тапсырыс беруге дайын`,
          body: `${p.storeName}, ${p.address}. Алу коды тапсырыста.`,
        }
      : {
          title: `Заказ №${p.number} готов к выдаче`,
          body: `${p.storeName}, ${p.address}. Код для получения — в заказе.`,
        },
  'order.courierRequested': (p, lang) =>
    lang === 'kk'
      ? {
          title: `№${p.number} тапсырысқа курьер шақырылды`,
          body: `Жеткізу: ${money(p.courierFee)}.`,
        }
      : { title: `К заказу №${p.number} вызван курьер`, body: `Доставка: ${money(p.courierFee)}.` },
  'order.handedToCourier': (p, lang) =>
    lang === 'kk'
      ? { title: `№${p.number} тапсырыс жолда`, body: `${p.storeName} тапсырысты курьерге берді.` }
      : { title: `Заказ №${p.number} в пути`, body: `${p.storeName} передал заказ курьеру.` },
  'order.completed': (p, lang) =>
    lang === 'kk'
      ? {
          title: `№${p.number} тапсырыс алынды`,
          body: 'Сатып алғаныңызға рахмет! 14 күн ішінде дүкенге қайтаруға болады.',
        }
      : {
          title: `Заказ №${p.number} получен`,
          body: 'Спасибо за покупку! Вернуть товар в магазин можно в течение 14 дней.',
        },
  'order.cancelledForCustomer': (p, lang) =>
    lang === 'kk'
      ? {
          title: `№${p.number} тапсырыс болдырылмады`,
          body: `${p.storeName}: ${reason(p.reason, lang)}.`,
        }
      : { title: `Заказ №${p.number} отменён`, body: `${p.storeName}: ${reason(p.reason, lang)}.` },
  'return.accepted': (p, lang) =>
    lang === 'kk'
      ? { title: 'Қайтару қабылданды', body: `№${p.number} тапсырыс, ${p.storeName}.` }
      : { title: 'Возврат принят', body: `Заказ №${p.number}, ${p.storeName}.` },
  'return.rejected': (p, lang) =>
    lang === 'kk'
      ? { title: 'Қайтарудан бас тартылды', body: `№${p.number}: ${p.reason}` }
      : { title: 'В возврате отказано', body: `Заказ №${p.number}: ${p.reason}` },
};

export function notificationText(type: string, params: Params, lang: Lang): Text {
  const render = TEXTS[type];
  if (!render) return { title: type, body: '' };
  return render(params, lang);
}

export const NOTIFICATION_TYPES = Object.keys(TEXTS);
