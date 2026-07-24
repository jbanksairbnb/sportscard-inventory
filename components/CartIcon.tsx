'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CART_CHANGED_EVENT, fetchCartCount } from '@/lib/cart';

// Nav cart button: a 🛒 link to /cart with a live item-count badge. Drop it into
// any buyer-facing header. It fetches the signed-in user's cart count once and
// refreshes whenever the cart changes (same tab via the CART_CHANGED_EVENT, and
// cross-tab via the storage-style `focus` re-check).
export default function CartIcon() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCount(0); return; }
    setCount(await fetchCartCount(supabase, user.id));
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => { refresh(); };
    window.addEventListener(CART_CHANGED_EVENT, onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener(CART_CHANGED_EVENT, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [refresh]);

  return (
    <Link
      href="/cart"
      className="btn btn-ghost btn-sm"
      aria-label={count > 0 ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>🛒</span>
      {count > 0 && (
        <span
          className="mono"
          aria-hidden
          style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 17, height: 17, padding: '0 4px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, lineHeight: 1,
            color: 'var(--cream)', background: 'var(--orange)',
            borderRadius: 100, border: '1.5px solid var(--cream)',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
