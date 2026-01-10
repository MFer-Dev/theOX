"use client";
import React from 'react';
import { useParams } from 'next/navigation';
import { ModerationDetail } from '../../../../src/screens/ModerationDetail';

export default function Page() {
  const params = useParams<{ id: string }>();
  return <ModerationDetail id={params.id} />;
}

