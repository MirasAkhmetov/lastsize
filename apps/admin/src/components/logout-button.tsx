'use client';

import { apiRequest } from '@lastsize/contracts';
import { Button } from '@lastsize/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="text"
      size="sm"
      loading={pending}
      onClick={async () => {
        setPending(true);
        await apiRequest('POST', '/auth/logout').catch(() => undefined);
        router.replace('/login');
        router.refresh();
      }}
    >
      Выйти
    </Button>
  );
}
