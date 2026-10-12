import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURE, type Fixture } from '../global-setup.js';

const fixture = (): Fixture => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;

async function addToCart(page: Page, productPath: string, size: string) {
  await page.goto(`/product/${productPath}`);
  await page.getByRole('button', { name: size, exact: true }).click();
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(page.getByText('Товар в корзине')).toBeVisible();
}

async function signInSeller(page: Page, phone: string, password: string) {
  await page.goto('/seller/login');
  await page.getByLabel('Телефон').fill(phone);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/seller\/dashboard/);
}

async function openSellerOrder(page: Page, number: number) {
  await page.goto(`/seller/orders?q=${number}`);
  await page.getByRole('link', { name: new RegExp(`Заказ №${number}`) }).click();
  await expect(page.getByRole('heading', { name: `Заказ №${number}` })).toBeVisible();
}

test('a buyer orders from two stores; one hands it over and takes a return, the other cancels', async ({
  page,
  browser,
}) => {
  const [a, b] = fixture().stores as [Fixture['stores'][0], Fixture['stores'][0]];
  const buyerPhone = `+7701${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

  // ── Buyer: cart from two stores, checkout without SMS ──
  await addToCart(page, a.productPath, a.size);
  await addToCart(page, b.productPath, b.size);
  await page.goto('/cart');
  await expect(page.getByRole('link', { name: a.name })).toBeVisible();
  await expect(page.getByRole('link', { name: b.name })).toBeVisible();
  await page.getByRole('link', { name: 'Оформить заказ' }).click();
  await page.getByLabel('Имя').fill('Покупатель E2E');
  await page.getByLabel('Телефон', { exact: true }).fill(buyerPhone);
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
  await page.waitForURL(/\/checkout\/success\/\d+/, { timeout: 45_000 });
  const number = Number(/success\/(\d+)/.exec(page.url())![1]);
  await expect(page.getByRole('heading', { name: `Заказ №${number} оформлен` })).toBeVisible();
  const codeA = await page
    .locator('section', { hasText: a.name })
    .getByText(/^\d{4}$/)
    .innerText();

  // ── Store A: confirm, prepare, hand over by code, take one pair back ──
  const storeA = await (await browser.newContext()).newPage();
  await signInSeller(storeA, a.phone, a.password);
  await openSellerOrder(storeA, number);
  await storeA.getByRole('button', { name: 'Подтвердить заказ' }).click();
  await expect(storeA.getByText('Подтверждён', { exact: true }).first()).toBeVisible();
  await storeA.getByRole('button', { name: 'Собран, готов к выдаче' }).click();
  await storeA.getByLabel('Код покупателя').fill(codeA);
  await storeA.getByRole('button', { name: 'Выдан покупателю' }).click();
  await expect(storeA.getByText('Получен', { exact: true }).first()).toBeVisible();
  await storeA.getByRole('spinbutton').first().fill('1');
  await storeA.getByRole('button', { name: 'Принять возврат' }).click();
  await expect(storeA.getByText(/возвращено 1/)).toBeVisible();

  // ── Store B: the pair is not there ──
  const storeB = await (await browser.newContext()).newPage();
  await signInSeller(storeB, b.phone, b.password);
  await openSellerOrder(storeB, number);
  await storeB.getByRole('button', { name: 'Подтвердить заказ' }).click();
  await expect(storeB.getByRole('button', { name: 'Собран, готов к выдаче' })).toBeVisible();
  storeB.once('dialog', (dialog) => void dialog.accept());
  await storeB.getByLabel('Причина отмены').selectOption('store.outOfStock');
  await storeB.getByRole('button', { name: 'Отменить заказ' }).click();
  await expect(storeB.getByText('Отменён', { exact: true }).first()).toBeVisible();

  // ── Buyer: sees each store's outcome and the notifications ──
  await page.goto(`/orders/${number}`);
  await expect(page.getByText('Выполнен частично')).toBeVisible();
  await expect(page.getByText('Товара не оказалось в наличии')).toBeVisible();
  await expect(page.getByText(/Возврат принят/)).toBeVisible();
  await page.goto('/notifications');
  await expect(page.getByText(`Заказ №${number} готов к выдаче`)).toBeVisible();
  await expect(page.getByText(`Заказ №${number} получен`)).toBeVisible();
});
