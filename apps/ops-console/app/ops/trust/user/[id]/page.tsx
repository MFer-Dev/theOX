"use client";
import React from 'react';
import { TrustDiagnostics } from '../../../../../src/screens/TrustDiagnostics';

type Props = { params: { id: string } };

export default function Page({ params }: Props) {
  return <TrustDiagnostics userId={params.id} />;
}

