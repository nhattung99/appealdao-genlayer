import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Scale,
  Wallet,
  Landmark,
  FilePlus,
  List,
  RefreshCw,
  ClipboardPaste,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Coins,
  Sparkles,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import {
  DEFAULT_CONTRACT_ADDRESS,
  isValidContractAddress,
  switchToGenlayerStudionet,
  sendContractTransaction,
  waitForFinalizedTx,
  waitForContractEffect,
  readContractState,
  parseGenToWei,
  formatWeiToGen,
  sanitizeGenInput,
  toWeiString,
  weiFromField,
  toPercentInt,
  sameAddress,
  txExplorerUrl,
  addressExplorerUrl,
  formatWriteError,
} from './genlayerClient.js';
import { minBigInt as minWei } from './money.js';
import { PLATFORMS, SAMPLE_FLAGGED_URLS, FUND_PRESETS } from './data/platforms.js';

const STORAGE_KEY = 'appealdao_contract_address';

const emptyConfig = {
  owner: '',
  appeal_deposit_amount: '0',
  overturned_bonus_amount: '0',
  pool_balance: '0',
  appeal_counter: '0',
  configured: false,
};

const shortAddr = (a) => {
  if (!a) return '—';
  const s = String(a);
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
};

const pasteClipboard = async () => {
  const text = await navigator.clipboard.readText();
  return (text || '').trim();
};

const statusClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s.includes('overturned')) return 'badge-overturned';
  if (s.includes('upheld')) return 'badge-upheld';
  if (s.includes('disputed')) return 'badge-disputed';
  if (s.includes('payout')) return 'badge-failed';
  return 'badge-submitted';
};

const loadStoredAddress = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidContractAddress(stored)) return stored.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_CONTRACT_ADDRESS;
};

export default function App() {
  const [account, setAccount] = useState(null);
  const [contractAddress, setContractAddress] = useState(loadStoredAddress);
  const [tab, setTab] = useState('home');
  const [config, setConfig] = useState(emptyConfig);
  const [appeals, setAppeals] = useState([]);
  const [details, setDetails] = useState({});
  const [txMessage, setTxMessage] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const [fundGen, setFundGen] = useState('10');
  const [platformId, setPlatformId] = useState('youtube');
  const [description, setDescription] = useState('');
  const [flaggedUrls, setFlaggedUrls] = useState(['']);
  const [policyUrls, setPolicyUrls] = useState(PLATFORMS[0].policyUrls.slice());
  const [evidenceAppealId, setEvidenceAppealId] = useState('');
  const [extraFlagged, setExtraFlagged] = useState(['']);
  const [extraPolicy, setExtraPolicy] = useState(['']);
  const [cfgDepositGen, setCfgDepositGen] = useState('1');
  const [cfgBonusGen, setCfgBonusGen] = useState('1');

  const hasContract = isValidContractAddress(contractAddress);
  const selectedPlatform = PLATFORMS.find((p) => p.id === platformId) || PLATFORMS[0];
  const isOwner = sameAddress(account, config.owner);
  const depositWei = weiFromField(config.appeal_deposit_amount);
  const bonusWei = weiFromField(config.overturned_bonus_amount);
  const poolWei = weiFromField(config.pool_balance);
  const contractReady = hasContract && Boolean(config.configured);
  const cappedBonus = minWei(bonusWei, poolWei);

  const persistAddress = (value) => {
    setContractAddress(value);
    try {
      if (isValidContractAddress(value)) localStorage.setItem(STORAGE_KEY, value.trim());
    } catch {
      /* ignore */
    }
  };

  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setTxMessage({ status: 'error', title: 'MetaMask required', detail: 'Install MetaMask to use AppealDAO on Studionet.' });
      return;
    }
    try {
      await switchToGenlayerStudionet();
      const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accs[0]);
    } catch (err) {
      setTxMessage({ status: 'error', title: 'Wallet connection failed', detail: err.message || String(err) });
    }
  };

  const loadConfig = useCallback(async () => {
    if (!hasContract) {
      setConfig(emptyConfig);
      return;
    }
    const res = await readContractState('get_config', [], contractAddress, account);
    if (res && typeof res === 'object') {
      setConfig({
        owner: String(res.owner || ''),
        appeal_deposit_amount: toWeiString(res.appeal_deposit_amount),
        overturned_bonus_amount: toWeiString(res.overturned_bonus_amount),
        pool_balance: toWeiString(res.pool_balance),
        appeal_counter: String(res.appeal_counter || '0'),
        configured: Boolean(res.configured),
      });
    }
  }, [hasContract, contractAddress, account]);

  const loadAppeals = useCallback(async () => {
    if (!hasContract) {
      setAppeals([]);
      return;
    }
    let rows = [];
    try {
      const listed = await readContractState('list_appeals', [], contractAddress, account);
      if (Array.isArray(listed)) rows = listed;
    } catch (err) {
      console.warn('list_appeals note:', err);
    }
    if (!rows.length) {
      const countRaw = await readContractState('get_appeal_count', [], contractAddress, account);
      const count = Number(countRaw || 0);
      const filled = [];
      for (let i = 0; i < count; i += 1) {
        const row = await readContractState('get_appeal', [String(i)], contractAddress, account);
        if (row && (row.id !== undefined || row.status)) {
          filled.push({ id: String(i), ...row });
        }
      }
      rows = filled;
    }
    setAppeals(rows);
  }, [hasContract, contractAddress, account]);

  const refreshAll = useCallback(async () => {
    await loadConfig();
    await loadAppeals();
  }, [loadConfig, loadAppeals]);

  useEffect(() => {
    refreshAll();
    if (!hasContract) return undefined;
    const timer = setInterval(() => { refreshAll(); }, 20000);
    return () => clearInterval(timer);
  }, [refreshAll, hasContract]);

  const loadDetail = async (appealId) => {
    const row = await readContractState('get_appeal', [String(appealId)], contractAddress);
    if (row && typeof row === 'object') {
      setDetails((prev) => ({ ...prev, [String(appealId)]: row }));
      return row;
    }
    return null;
  };

  const snapshotConfig = async () => {
    const res = await readContractState('get_config', [], contractAddress, account);
    if (!res || typeof res !== 'object') {
      return {
        pool: 0n,
        counter: 0n,
        deposit: 0n,
        bonus: 0n,
      };
    }
    return {
      pool: weiFromField(res.pool_balance),
      counter: BigInt(String(res.appeal_counter || '0').replace(/[^0-9]/g, '') || '0'),
      deposit: weiFromField(res.appeal_deposit_amount),
      bonus: weiFromField(res.overturned_bonus_amount),
    };
  };

  const runWrite = async (
    title,
    functionName,
    args,
    value = 0n,
    { ai = false, appealId = null, confirm = null } = {}
  ) => {
    if (!hasContract) throw new Error('Contract address is not configured yet.');
    if (!account) throw new Error('Connect MetaMask first.');
    setBusy(true);
    if (ai) setResolvingId(appealId);
    setTxMessage({
      status: ai ? 'consensus' : 'pending',
      title: ai ? 'Waiting for GenLayer AI consensus…' : `Submitting ${title}`,
      detail: ai
        ? 'Validators compare the binary verdict (OVERTURNED vs UPHELD). This can take a minute.'
        : 'Confirm in MetaMask on GenLayer Studionet. Keep this tab open until confirmation finishes.',
    });
    try {
      const before = confirm ? await snapshotConfig() : null;
      const hash = await sendContractTransaction({
        from: account,
        to: contractAddress,
        functionName,
        args,
        value,
      });

      setTxMessage({
        status: 'pending',
        title: `${title} submitted`,
        detail: 'Waiting for Studionet inclusion + GenVM execution…',
        hash,
      });

      const receipt = await waitForFinalizedTx(hash, ai ? 90 : 40, ai ? 4000 : 2500);
      if (receipt?.pending) {
        setTxMessage({
          status: 'pending',
          title: `${title}: confirming on-chain state…`,
          detail: receipt.warning || 'EVM receipt slow — verifying contract storage instead.',
          hash,
        });
      }

      if (confirm) {
        setTxMessage({
          status: 'pending',
          title: `${title}: waiting for contract storage…`,
          detail: 'Studionet GenVM can lag a few seconds behind the MetaMask confirmation.',
          hash,
        });
        await waitForContractEffect({
          label: title,
          retries: ai ? 60 : 36,
          intervalMs: ai ? 4000 : 2500,
          read: async () => {
            const after = await snapshotConfig();
            return { before, after };
          },
          predicate: async ({ before: b, after }) => {
            const ok = await confirm(b, after);
            return Boolean(ok);
          },
        });
      }

      setTxMessage({
        status: 'success',
        title: `${title} confirmed on Studionet`,
        detail: hash,
        hash,
      });
      await refreshAll();
      if (appealId) await loadDetail(appealId);
      return hash;
    } catch (err) {
      const detail = formatWriteError(err) || err.message || String(err);
      setTxMessage({
        status: 'error',
        title: `${title} failed`,
        detail,
      });
      // Re-sync UI so a late-landing tx still shows up.
      try { await refreshAll(); } catch { /* ignore */ }
      throw err;
    } finally {
      setBusy(false);
      setResolvingId(null);
    }
  };

  const handleFund = async () => {
    const wei = parseGenToWei(fundGen);
    if (wei <= 0n) {
      setTxMessage({ status: 'error', title: 'Invalid amount', detail: 'Enter a GEN amount greater than 0.' });
      return;
    }
    await runWrite('Fund community pool', 'fund_pool', [], wei, {
      confirm: (before, after) => after.pool >= before.pool + wei,
    });
  };

  const handleFileAppeal = async () => {
    if (!contractReady) {
      setTxMessage({ status: 'error', title: 'Deposit not configured', detail: 'Owner must call set_config before appeals can be filed.' });
      return;
    }
    if (depositWei <= 0n) {
      setTxMessage({ status: 'error', title: 'Deposit missing', detail: 'Refresh the page. Appeal deposit must be > 0 on-chain.' });
      return;
    }
    const flagged = flaggedUrls.map((u) => u.trim()).filter(Boolean);
    const policies = policyUrls.map((u) => u.trim()).filter(Boolean);
    if (!description.trim()) {
      setTxMessage({ status: 'error', title: 'Description required', detail: 'Describe the flagged content or ban notice.' });
      return;
    }
    if (flagged.length < 1) {
      setTxMessage({ status: 'error', title: 'Evidence required', detail: 'Paste at least one flagged-content URL.' });
      return;
    }
    if (policies.length < 2) {
      setTxMessage({ status: 'error', title: 'Policy sources required', detail: 'Need at least 2 independent policy reference URLs.' });
      return;
    }
    try {
      await runWrite(
        'File appeal',
        'file_appeal',
        [selectedPlatform.name, description.trim(), flagged, policies],
        depositWei,
        {
          confirm: (before, after) => after.counter > before.counter,
        }
      );
      setDescription('');
      setFlaggedUrls(['']);
      setTab('appeals');
    } catch {
      // Error banner already set inside runWrite.
    }
  };

  const handleResolve = async (appealId) => {
    const beforeRow = details[String(appealId)] || appeals.find((a) => String(a.id) === String(appealId)) || {};
    const beforeStatus = String(beforeRow.status || 'SUBMITTED');
    await runWrite('AI adjudication', 'resolve_appeal', [String(appealId)], 0n, {
      ai: true,
      appealId,
      confirm: async () => {
        const row = await readContractState('get_appeal', [String(appealId)], contractAddress, account);
        if (!row || typeof row !== 'object') return false;
        const status = String(row.status || '');
        return status !== beforeStatus && status !== '';
      },
    });
  };

  const handleRetry = async (appealId) => {
    await runWrite('Retry payout', 'retry_resolution', [String(appealId)], 0n, {
      appealId,
      confirm: async () => {
        const row = await readContractState('get_appeal', [String(appealId)], contractAddress, account);
        return Boolean(row && String(row.status) === 'RESOLVED_OVERTURNED');
      },
    });
  };

  const handleAddEvidence = async () => {
    const flagged = extraFlagged.map((u) => u.trim()).filter(Boolean);
    const policies = extraPolicy.map((u) => u.trim()).filter(Boolean);
    if (!evidenceAppealId) return;
    if (flagged.length < 1 && policies.length < 1) {
      setTxMessage({ status: 'error', title: 'Evidence required', detail: 'Add at least one URL.' });
      return;
    }
    await runWrite('Add evidence', 'add_evidence', [String(evidenceAppealId), flagged, policies], 0n, {
      appealId: evidenceAppealId,
      confirm: async () => {
        const row = await readContractState('get_appeal', [String(evidenceAppealId)], contractAddress, account);
        return Boolean(row && String(row.status) === 'SUBMITTED');
      },
    });
    setExtraFlagged(['']);
    setExtraPolicy(['']);
  };

  const handleSetConfig = async () => {
    const deposit = parseGenToWei(cfgDepositGen);
    const bonus = parseGenToWei(cfgBonusGen);
    if (deposit <= 0n || bonus <= 0n) {
      setTxMessage({ status: 'error', title: 'Invalid config', detail: 'Both deposit and bonus must be greater than 0 GEN.' });
      return;
    }
    await runWrite('Set config', 'set_config', [deposit, bonus], 0n, {
      confirm: (_before, after) => after.deposit === deposit && after.bonus === bonus,
    });
  };

  const applyPlatform = (id) => {
    setPlatformId(id);
    const plat = PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
    setPolicyUrls(plat.policyUrls.slice());
  };

  const setUrlAt = (list, setter, index, value) => {
    const next = list.slice();
    next[index] = value;
    setter(next);
  };

  const addUrl = (list, setter) => setter([...list, '']);
  const removeUrl = (list, setter, index) => {
    if (list.length <= 1) {
      setter(['']);
      return;
    }
    setter(list.filter((_, i) => i !== index));
  };

  const UrlRow = ({ value, onChange, onRemove }) => (
    <div className="url-row">
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://" />
      <button type="button" className="btn-ghost" onClick={async () => onChange(await pasteClipboard())} title="Paste from clipboard">
        <ClipboardPaste size={16} />
      </button>
      <button type="button" className="btn-ghost" onClick={onRemove} title="Remove">
        <Trash2 size={16} />
      </button>
    </div>
  );

  const stats = useMemo(() => ([
    { label: 'Community pool', value: `${formatWeiToGen(poolWei)} GEN`, hint: 'Available for overturned bonuses' },
    { label: 'Appeal deposit', value: depositWei > 0n ? `${formatWeiToGen(depositWei)} GEN` : 'Not configured', hint: 'Exact amount sent with every appeal' },
    { label: 'Overturned bonus', value: bonusWei > 0n ? `${formatWeiToGen(bonusWei)} GEN` : 'Not configured', hint: `Capped at pool: ${formatWeiToGen(cappedBonus)} GEN` },
  ]), [poolWei, depositWei, bonusWei, cappedBonus]);

  return (
    <div className="app">
      <div className="free-banner">
        Free to use — you only pay GenLayer network gas when you sign a transaction. There are no other platform fees. The appeal deposit and community pool are protocol mechanics, not fees collected by the development team.
      </div>

      <header className="header">
        <div className="brand">
          <div className="brand-mark"><Scale size={22} /></div>
          <div>
            <h1>AppealDAO</h1>
            <p>Mutual-aid creator appeals on GenLayer Studionet</p>
          </div>
        </div>
        <div className="header-right">
          <div className="network"><span className="dot" /> Studionet</div>
          {account ? (
            <button className="btn-secondary" type="button"><Wallet size={16} /> {shortAddr(account)}</button>
          ) : (
            <button className="btn-primary" type="button" onClick={connectWallet}><Wallet size={16} /> Connect MetaMask</button>
          )}
        </div>
      </header>

      {!hasContract ? (
        <div className="missing-banner">
          <AlertTriangle size={20} />
          <div>
            <strong>Contract address not configured.</strong> Deploy <code>contracts/appeal_dao.py</code> on GenLayer Studio, confirm <em>Result: SUCCESS</em>, then paste the address here. The app stays in preview mode and will not crash.
            <div className="url-row" style={{ marginTop: '0.75rem' }}>
              <input
                className="input"
                placeholder="0x… deployed AppealDAO address"
                value={contractAddress}
                onChange={(e) => persistAddress(e.target.value.trim())}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="ok-banner">
          <CheckCircle2 size={18} />
          <div>
            Connected to AppealDAO · <a href={addressExplorerUrl(contractAddress)} target="_blank" rel="noreferrer">{shortAddr(contractAddress)}</a>
            {!config.configured && ' · Owner still needs to call set_config before appeals can be filed.'}
          </div>
        </div>
      )}

      {txMessage && (
        <div className={txMessage.status === 'error' ? 'err-banner' : txMessage.status === 'success' ? 'ok-banner' : 'info-banner'}>
          {txMessage.status === 'error' ? <XCircle size={18} /> : txMessage.status === 'success' ? <CheckCircle2 size={18} /> : <RefreshCw size={18} className="spin" />}
          <div>
            <strong>{txMessage.title}</strong>
            {txMessage.hash ? (
              <div><a href={txExplorerUrl(txMessage.hash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a></div>
            ) : (
              <div>{txMessage.detail}</div>
            )}
          </div>
        </div>
      )}

      <div className="stats-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <span>{s.label}</span>
            <b>{s.value}</b>
            <em>{s.hint}</em>
          </div>
        ))}
      </div>

      <div className="tabs">
        <button type="button" className={`tab ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}><Landmark size={16} /> Pool & file</button>
        <button type="button" className={`tab ${tab === 'appeals' ? 'active' : ''}`} onClick={() => setTab('appeals')}><List size={16} /> Appeals</button>
        {isOwner && (
          <button type="button" className={`tab ${tab === 'owner' ? 'active' : ''}`} onClick={() => setTab('owner')}><Coins size={16} /> Owner</button>
        )}
      </div>

      {tab === 'home' && (
        <div className="grid">
          <section className="card">
            <h2><Landmark size={18} /> Contribute to the community pool</h2>
            <p className="hint">Anyone can fund the mutual-aid pool. Overturned appeals receive a fixed bonus taken from this balance, never more than the pool holds.</p>
            <div className="chips">
              {FUND_PRESETS.map((p) => (
                <button type="button" key={p} className={`chip ${fundGen === p ? 'active' : ''}`} onClick={() => setFundGen(p)}>{p} GEN</button>
              ))}
            </div>
            <label className="label">Amount (GEN)</label>
            <input
              className="input"
              inputMode="decimal"
              value={fundGen}
              onChange={(e) => setFundGen(sanitizeGenInput(e.target.value))}
              placeholder="10"
            />
            <p className="hint">Sends {formatWeiToGen(parseGenToWei(fundGen))} GEN ({parseGenToWei(fundGen).toString()} wei). Wallet needs this amount plus gas from Studio → Accounts.</p>
            <button className="btn-primary full" type="button" disabled={busy || !hasContract || !account} onClick={handleFund}>
              <Coins size={16} /> Fund pool
            </button>
          </section>

          <section className="card">
            <h2><FilePlus size={18} /> File an appeal</h2>
            <p className="hint">Deposit is locked at {depositWei > 0n ? `${formatWeiToGen(depositWei)} GEN` : '—'} and sent automatically. If the ban is overturned you receive the deposit back plus a bonus capped at {formatWeiToGen(cappedBonus)} GEN.</p>

            <label className="label">Platform</label>
            <div className="chips">
              {PLATFORMS.map((p) => (
                <button type="button" key={p.id} className={`chip ${platformId === p.id ? 'active' : ''}`} onClick={() => applyPlatform(p.id)}>{p.name}</button>
              ))}
            </div>

            <label className="label">What was flagged or banned?</label>
            <textarea
              className="input textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the content, the platform action, and why you believe it does not violate the public policy."
            />

            <label className="label">Flagged content / ban-notice URLs (min 1)</label>
            <div className="chips" style={{ marginBottom: '0.5rem' }}>
              {SAMPLE_FLAGGED_URLS.map((url) => (
                <button
                  type="button"
                  key={url}
                  className="chip"
                  onClick={() => setFlaggedUrls((prev) => {
                    const next = prev.slice();
                    const empty = next.findIndex((u) => !u.trim());
                    if (empty >= 0) next[empty] = url;
                    else next.push(url);
                    return next;
                  })}
                >
                  Use sample
                </button>
              ))}
            </div>
            {flaggedUrls.map((url, i) => (
              <UrlRow
                key={`f-${i}`}
                value={url}
                onChange={(v) => setUrlAt(flaggedUrls, setFlaggedUrls, i, v)}
                onRemove={() => removeUrl(flaggedUrls, setFlaggedUrls, i)}
              />
            ))}
            <button type="button" className="btn-ghost" onClick={() => addUrl(flaggedUrls, setFlaggedUrls)}><Plus size={14} /> Add evidence URL</button>

            <label className="label" style={{ marginTop: '1rem' }}>Independent policy reference URLs (min 2)</label>
            {policyUrls.map((url, i) => (
              <UrlRow
                key={`p-${i}`}
                value={url}
                onChange={(v) => setUrlAt(policyUrls, setPolicyUrls, i, v)}
                onRemove={() => removeUrl(policyUrls, setPolicyUrls, i)}
              />
            ))}
            <button type="button" className="btn-ghost" onClick={() => addUrl(policyUrls, setPolicyUrls)}><Plus size={14} /> Add policy URL</button>

            <button
              className="btn-primary full"
              type="button"
              style={{ marginTop: '1rem' }}
              disabled={busy || !contractReady || !account}
              onClick={handleFileAppeal}
            >
              <Scale size={16} /> File appeal · {formatWeiToGen(depositWei)} GEN deposit
            </button>
          </section>
        </div>
      )}

      {tab === 'appeals' && (
        <section className="card">
          <div className="card-header">
            <h2><List size={18} /> Appeals</h2>
            <button type="button" className="btn-secondary" onClick={refreshAll} disabled={busy}><RefreshCw size={14} /> Refresh</button>
          </div>
          {!appeals.length && <p className="hint">No appeals yet. File one from the Pool & file tab.</p>}
          <div className="appeal-list">
            {appeals.map((row) => {
              const id = String(row.id);
              const detail = details[id] || row;
              const resolving = resolvingId === id;
              return (
                <article className="appeal-card" key={id}>
                  <div className="appeal-top">
                    <div>
                      <strong>#{id} · {detail.platform_name || row.platform_name}</strong>
                      <div className="mono">{shortAddr(detail.creator || row.creator)}</div>
                    </div>
                    <span className={`badge ${statusClass(detail.status)}`}>{detail.status}</span>
                  </div>
                  <p>{detail.content_description || row.content_description}</p>
                  <div className="tier-grid">
                    <div><span>Deposit</span><b>{formatWeiToGen(weiFromField(detail.deposit_paid))} GEN</b></div>
                    <div><span>Confidence</span><b>{toPercentInt(detail.confidence)} / 100</b></div>
                    <div><span>Verdict</span><b>{detail.verdict || '—'}</b></div>
                    <div><span>Payout</span><b>{formatWeiToGen(weiFromField(detail.final_payout_amount))} GEN</b></div>
                  </div>
                  {detail.verdict_reason && <p className="reason">{detail.verdict_reason}</p>}
                  {detail.status === 'RESOLVED_UPHELD' && (
                    <p className="hint">Deposit was added to the community pool. No transfer was sent.</p>
                  )}
                  {detail.status === 'RESOLVED_OVERTURNED' && (
                    <p className="hint">Creator received deposit + bonus (bonus capped by pool at resolve time).</p>
                  )}
                  <div className="row-actions">
                    <button type="button" className="btn-ghost" onClick={() => loadDetail(id)}>Details</button>
                    {(detail.status === 'SUBMITTED' || detail.status === 'DISPUTED') && (
                      <button type="button" className="btn-ai" disabled={busy} onClick={() => handleResolve(id)}>
                        {resolving ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />}
                        {resolving ? 'AI consensus running…' : 'Request AI adjudication'}
                      </button>
                    )}
                    {detail.status === 'DISPUTED' && sameAddress(account, detail.creator) && (
                      <button type="button" className="btn-secondary" onClick={() => setEvidenceAppealId(id)}>
                        Add evidence
                      </button>
                    )}
                    {detail.status === 'PAYOUT_FAILED' && sameAddress(account, detail.creator) && (
                      <button type="button" className="btn-primary" disabled={busy} onClick={() => handleRetry(id)}>
                        <RotateCcw size={16} /> Retry payout
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {evidenceAppealId && (
            <div className="card nested">
              <h3>Add evidence to appeal #{evidenceAppealId}</h3>
              <label className="label">Additional flagged URLs</label>
              {extraFlagged.map((url, i) => (
                <UrlRow key={`ef-${i}`} value={url} onChange={(v) => setUrlAt(extraFlagged, setExtraFlagged, i, v)} onRemove={() => removeUrl(extraFlagged, setExtraFlagged, i)} />
              ))}
              <button type="button" className="btn-ghost" onClick={() => addUrl(extraFlagged, setExtraFlagged)}><Plus size={14} /> Add</button>
              <label className="label">Additional policy URLs</label>
              {extraPolicy.map((url, i) => (
                <UrlRow key={`ep-${i}`} value={url} onChange={(v) => setUrlAt(extraPolicy, setExtraPolicy, i, v)} onRemove={() => removeUrl(extraPolicy, setExtraPolicy, i)} />
              ))}
              <button className="btn-primary" type="button" disabled={busy} onClick={handleAddEvidence}>Attach evidence</button>
            </div>
          )}
        </section>
      )}

      {tab === 'owner' && isOwner && (
        <section className="card">
          <h2><Info size={18} /> Owner config</h2>
          <p className="hint">Both amounts are stored as wei. No percentages. Must be greater than 0.</p>
          <label className="label">Appeal deposit (GEN)</label>
          <input className="input" value={cfgDepositGen} onChange={(e) => setCfgDepositGen(sanitizeGenInput(e.target.value))} />
          <label className="label">Overturned bonus (GEN)</label>
          <input className="input" value={cfgBonusGen} onChange={(e) => setCfgBonusGen(sanitizeGenInput(e.target.value))} />
          <p className="hint">
            Deposit {parseGenToWei(cfgDepositGen).toString()} wei · Bonus {parseGenToWei(cfgBonusGen).toString()} wei
          </p>
          <button className="btn-primary" type="button" disabled={busy} onClick={handleSetConfig}>Save config</button>
        </section>
      )}
    </div>
  );
}
