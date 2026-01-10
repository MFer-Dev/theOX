import React, { useState } from 'react';
import { opsClient } from '../api/opsClient';

type Props = {
  onSuccess: () => void;
};

export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState('');
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await opsClient.login({ email, password });
      if ((res as any)?.mfaRequired) {
        setNeedMfa(true);
      } else {
        window.location.href = '/ops';
      }
    } catch (e: any) {
      setError(e?.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const verifyMfa = async () => {
    setError(null);
    setLoading(true);
    try {
      await opsClient.mfa({ token: mfa });
      window.location.href = '/ops';
    } catch (e: any) {
      setError(e?.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-10">
      <h1 className="text-2xl font-semibold mb-2">Ops Console</h1>
      <p className="text-sm text-gray-600 mb-6">Authorized personnel only.</p>
      {error ? <div className="bg-red-50 text-red-600 p-2 mb-3 rounded">{error}</div> : null}
      <div className="space-y-3">
        <div>
          <label className="block text-sm">Email</label>
          <input className="w-full border p-2 rounded" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm">Password</label>
          <input type="password" className="w-full border p-2 rounded" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {needMfa ? (
          <div>
            <label className="block text-sm">MFA code</label>
            <input className="w-full border p-2 rounded" value={mfa} onChange={(e) => setMfa(e.target.value)} />
            <button className="mt-2 px-3 py-2 bg-blue-600 text-white rounded" onClick={verifyMfa} disabled={loading}>
              Verify
            </button>
          </div>
        ) : (
          <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={submit} disabled={loading}>
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}

