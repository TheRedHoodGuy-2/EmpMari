'use client';
import { usePathname } from 'next/navigation';
import { useRef, useEffect, type ReactNode } from 'react';

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    // Next frame — trigger transition
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.22s cubic-bezier(.4,0,.2,1), transform 0.22s cubic-bezier(.4,0,.2,1)';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  return (
    <div ref={ref} style={{ height: '100%' }}>
      {children}
    </div>
  );
}
