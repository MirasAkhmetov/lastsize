import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { EmptyState } from './feedback';
import { TextField } from './field';
import { Price } from './price';
import { ProductCard } from './product-card';
import { SizeChip } from './size-chip';

describe('SizeChip', () => {
  it('cannot select a sold-out size and announces why', async () => {
    const onClick = vi.fn();
    render(<SizeChip label="41" state="unavailable" onClick={onClick} />);
    const chip = screen.getByRole('button', { name: /41, нет в наличии/ });
    expect(chip).toBeDisabled();
    await userEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks the last size for screen readers and reflects selection', () => {
    render(<SizeChip label="40" state="last" selected />);
    const chip = screen.getByRole('button', { name: /40, последний/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Price', () => {
  it('shows the old price struck through with an accessible label', () => {
    render(<Price salePrice={3_999_000} originalPrice={5_999_000} />);
    expect(screen.getByText(/Цена до скидки/)).toBeInTheDocument();
    expect(document.querySelector('s')).toHaveTextContent(/59\s990/);
  });

  it('shows no old price when there is no discount', () => {
    render(<Price salePrice={3_999_000} originalPrice={3_999_000} />);
    expect(document.querySelector('s')).toBeNull();
  });
});

describe('ProductCard', () => {
  it('shows brand, discount, sizes in stock, scarcity and the store', () => {
    render(
      <ProductCard
        href="/product/nike-air-max-270-k7f2q9mx"
        brand="Nike"
        title="Air Max 270"
        salePrice={3_999_000}
        originalPrice={5_999_000}
        discountPercent={33}
        sizes={[
          { label: '39', available: true },
          { label: '41', available: false },
        ]}
        scarcityNote="Остался 1 размер 40"
        storeName="Sneakerhead"
        city="Алматы"
      />,
    );
    expect(screen.getByRole('link', { name: /Nike/ })).toHaveAttribute(
      'href',
      '/product/nike-air-max-270-k7f2q9mx',
    );
    expect(screen.getByText('\u221233%')).toBeInTheDocument();
    expect(screen.getByText('41')).toHaveClass('line-through');
    expect(screen.getByText('Остался 1 размер 40')).toBeInTheDocument();
    expect(screen.getByText('Sneakerhead · Алматы')).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Войти</Button>);
    const button = screen.getByRole('button', { name: 'Войти' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('TextField', () => {
  it('links the error message to the input', () => {
    render(<TextField label="Телефон" error="Введите номер" />);
    const input = screen.getByLabelText('Телефон');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Введите номер');
  });
});

describe('EmptyState', () => {
  it('renders the next step', () => {
    render(<EmptyState title="Корзина пустая" action={<a href="/sale">Смотреть распродажу</a>} />);
    expect(screen.getByRole('heading', { name: 'Корзина пустая' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Смотреть распродажу' })).toBeInTheDocument();
  });
});
