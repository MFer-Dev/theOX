import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function Agents() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [type, setType] = useState('support_assist');
  const [summary, setSummary] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [reason, setReason] = useState('');
  const [patchedJson, setPatchedJson] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res: any = await opsClient.agentTasks();
      setTasks(res?.tasks ?? []);
      if (!selectedId && (res?.tasks?.[0]?.id as string | undefined)) setSelectedId(res.tasks[0].id);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!summary.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.agentCreateTask({ type, summary });
      setSummary('');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create');
    } finally {
      setLoading(false);
    }
  };

  const parsePatched = (): any | null => {
    const raw = String(patchedJson ?? '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      setError('Patched action must be valid JSON.');
      return null;
    }
  };

  const submitDecision = async (id: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const r = String(reason ?? '').trim();
      if (!r) {
        setError('Reason is required.');
        return;
      }
      const patched = parsePatched();
      if (patchedJson.trim() && !patched) return;
      await opsClient.agentApproveTask(id, decision, r, patched);
      setSuccess(`Task ${decision}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit decision');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const selected = tasks.find((t) => String(t.id) === String(selectedId)) ?? null;

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Agents</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {success ? <div className="bg-green-50 text-green-700 p-2 rounded">{success}</div> : null}
      <div className="border rounded p-3 bg-white space-y-2">
        <div className="font-semibold">Create task (L1 – human approved)</div>
        <select className="border p-2 rounded w-full" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="support_assist">Support assist</option>
          <option value="safety_triage">Safety triage</option>
          <option value="reliability_triage">Reliability triage</option>
          <option value="growth_ops">Growth ops</option>
        </select>
        <input
          className="border p-2 rounded w-full"
          placeholder="Summary (what should be investigated / done)"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={create} disabled={loading || !summary.trim()}>
          Create
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Task inbox</div>
          {tasks.length === 0 ? <div className="text-sm text-gray-500">No tasks.</div> : null}
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className={`border rounded p-3 cursor-pointer ${String(t.id) === String(selectedId) ? 'border-blue-600' : ''}`}
                onClick={() => setSelectedId(String(t.id))}
              >
                <div className="font-semibold">{t.summary}</div>
                <div className="text-sm text-gray-500">
                  type={t.type} · status={t.status} · updated={t.updated_at ?? t.created_at}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="border rounded p-3 bg-white space-y-3">
          <div className="font-semibold">Task detail</div>
          {!selected ? <div className="text-sm text-gray-500">Select a task.</div> : null}
          {selected ? (
            <>
              <div className="text-sm text-gray-600">status={selected.status}</div>
              <div>
                <div className="text-sm font-semibold">Evidence</div>
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(selected.evidence ?? {}, null, 2)}</pre>
              </div>
              <div>
                <div className="text-sm font-semibold">Proposed actions</div>
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">
                  {JSON.stringify(selected.proposed_actions ?? [], null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-sm font-semibold">Execution results</div>
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">
                  {JSON.stringify(selected.execution_results ?? [], null, 2)}
                </pre>
              </div>
              <div className="border-t pt-3 space-y-2">
                <div className="text-sm font-semibold">Decision (reason required)</div>
                <select className="border p-2 rounded w-full" value={decision} onChange={(e) => setDecision(e.target.value as any)}>
                  <option value="approved">Approve</option>
                  <option value="rejected">Reject</option>
                </select>
                <input
                  className="border p-2 rounded w-full"
                  placeholder="Reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div>
                  <div className="text-xs text-gray-500">Optional: patched action JSON (overrides proposed actions on approve)</div>
                  <textarea
                    className="border p-2 rounded w-full font-mono text-xs"
                    placeholder='{"tool":"safety.revoke_friction","args":{"friction_id":"...","reason":"..."}}'
                    value={patchedJson}
                    onChange={(e) => setPatchedJson(e.target.value)}
                    rows={6}
                  />
                </div>
                <button
                  className="px-3 py-2 bg-blue-600 text-white rounded"
                  onClick={() => submitDecision(String(selected.id))}
                  disabled={loading}
                >
                  Submit
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}


