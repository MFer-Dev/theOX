"use client";
import React from 'react';
import { useParams } from 'next/navigation';
import { UserDetail } from '../../../../src/screens/UserDetail';

export default function Page() {
  const params = useParams<{ id: string }>();
  return <UserDetail id={params.id} />;
}

