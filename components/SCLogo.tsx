'use client';

import React from 'react';
import Image from 'next/image';

export default function SCLogo({ size = 80 }: { size?: number }) {
  return (
    <Image
      src="/sports-collective-logo.png"
      alt="Sports Collective"
      width={size}
      height={size}
      style={{ display: 'block', flexShrink: 0 }}
    />
  );
}