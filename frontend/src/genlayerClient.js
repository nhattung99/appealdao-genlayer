import { createClient } from 'genlayer-js';
import { studionet as officialStudionet } from 'genlayer-js/chains';
import { ExecutionResult, TransactionStatus } from 'genlayer-js/types';
import { toHex, toRlp } from 'viem';
import {
  parseGenToWei,
  formatWeiToGen,
  sanitizeGenInput,
  toWeiString,
  weiFromField,
  toPercentInt,
  WEI_PER_GEN,
} from './money.js';

export {
  parseGenToWei,
  formatWeiToGen,
  sanitizeGenInput,
  toWeiString,
  weiFromField,
  toPercentInt,
  WEI_PER_GEN,
};

const ZERO = '0x0000000000000000000000000000000000000000';
const rawAddress = (import.meta.env.VITE_CONTRACT_ADDRESS || '').trim();

export const DEFAULT_CONTRACT_ADDRESS = rawAddress;
export const EXPLORER_BASE = 'https://genlayer-explorer.vercel.app';

export const isValidContractAddress = (addr) => {
  const s = String(addr || '').trim();
  return Boolean(s && s !== ZERO && /^0x[0-9a-fA-F]{40}$/.test(s));
};

export const hasContractAddress = isValidContractAddress(rawAddress);

export const studionet = officialStudionet || {
  id: 61999,
  name: 'GenLayer Studionet',
  rpcUrl: 'https://studio.genlayer.com/api',
  nativeCurrency: {
    name: 'GenLayer Token',
    symbol: 'GEN',
    decimals: 18,
  },
};

const toAddress = (account) => {
  if (!account) return '';
  if (typeof account === 'string') return account;
  return account.address || '';
};

const toWriteAccount = (account) => {
  const address = toAddress(account);
  if (!address) return null;
  return { address };
};

export const sameAddress = (a, b) => {
  const left = toAddress(a).toLowerCase();
  const right = toAddress(b).toLowerCase();
  if (!left || !right) return false;
  return left === right;
};

export const getGenlayerClient = (account) => {
  try {
    const cfg = {
      chain: officialStudionet || studionet,
    };
    const address = toAddress(account);
    if (address) cfg.account = address;
    if (typeof window !== 'undefined' && window.ethereum) {
      cfg.provider = window.ethereum;
    }
    return createClient(cfg);
  } catch (err) {
    console.warn('GenLayer client initialization fallback:', err);
    return null;
  }
};

const asPlain = (val) => {
  if (val instanceof Map) {
    const obj = {};
    for (const [k, v] of val.entries()) obj[String(k)] = asPlain(v);
    return obj;
  }
  if (Array.isArray(val)) return val.map(asPlain);
  return val;
};

export const unwrapViewResult = (val) => {
  const plain = asPlain(val);
  if (typeof plain === 'string') {
    const trimmed = plain.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return plain;
      }
    }
  }
  return plain;
};

export const formatWriteError = (err) => {
  const msg = String(err?.shortMessage || err?.details || err?.message || err || '');
  const low = msg.toLowerCase();
  if (low.includes('user rejected') || low.includes('user denied') || low.includes('rejected the request')) {
    return 'Transaction cancelled in MetaMask.';
  }
  if (low.includes('insufficient') || low.includes('funds')) {
    return 'Not enough GEN for this amount plus gas. Fund the wallet from GenLayer Studio → Accounts.';
  }
  if (low.includes('invalid address') || (low.includes('undefined') && low.includes('address'))) {
    return 'Wallet address was not attached. Reconnect MetaMask on GenLayer Studionet and retry.';
  }
  return msg || 'Write transaction failed.';
};

const toValueBigInt = (value) => {
  if (typeof value === 'bigint') return value < 0n ? 0n : value;
  if (typeof value === 'number') return 0n;
  const raw = String(value || '0x0').trim();
  if (raw === '' || raw === '0x' || raw === '0x0') return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
};

const isHexStub = (val) => typeof val === 'string' && /^0x[0-9a-fA-F]+$/.test(val);

export const encodeGenLayerCalldata = (method, args = []) => {
  const BITS = 3; const T_SPECIAL = 0; const T_PINT = 1; const T_NINT = 2; const T_STR = 4; const T_ARR = 5; const T_MAP = 6;
  const SPECIAL_NULL = 0; const SPECIAL_FALSE = 1 << BITS; const SPECIAL_TRUE = 2 << BITS;

  function writeNum(to, n) {
    if (n === 0n) { to.push(0); return; }
    while (n > 0) {
      let cur = Number(n & 0x7fn); n >>= 7n;
      if (n > 0) cur |= 128;
      to.push(cur);
    }
  }
  function encodeNumWithType(to, n, type) { writeNum(to, (n << BigInt(BITS)) | BigInt(type)); }
  function encodeImpl(to, data) {
    if (data === null || data === undefined) { to.push(SPECIAL_NULL); return; }
    if (data === true) { to.push(SPECIAL_TRUE); return; }
    if (data === false) { to.push(SPECIAL_FALSE); return; }
    if (typeof data === 'number' || typeof data === 'bigint') {
      const n = BigInt(data);
      encodeNumWithType(to, n >= 0n ? n : -n - 1n, n >= 0n ? T_PINT : T_NINT);
      return;
    }
    if (typeof data === 'string') {
      const str = new TextEncoder().encode(data);
      encodeNumWithType(to, BigInt(str.length), T_STR);
      for (const c of str) to.push(c);
      return;
    }
    if (Array.isArray(data)) {
      encodeNumWithType(to, BigInt(data.length), T_ARR);
      for (const c of data) encodeImpl(to, c);
      return;
    }
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      const entries = keys.map((k) => [new TextEncoder().encode(k), data[k]]);
      entries.sort((a, b) => {
        for (let i = 0; i < a[0].length && i < b[0].length; i++) {
          const diff = a[0][i] - b[0][i];
          if (diff !== 0) return diff;
        }
        return a[0].length - b[0].length;
      });
      encodeNumWithType(to, BigInt(entries.length), T_MAP);
      for (const [k, v] of entries) {
        writeNum(to, BigInt(k.length));
        for (const c of k) to.push(c);
        encodeImpl(to, v);
      }
    }
  }

  const arr = [];
  encodeImpl(arr, { method, args });
  return toRlp([toHex(new Uint8Array(arr))]);
};

const STUDIO_RPC = 'https://studio.genlayer.com/api';

const studioRpc = async (method, params = []) => {
  const res = await fetch(STUDIO_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  }).then((r) => r.json());
  if (res?.error) throw new Error(res.error.message || JSON.stringify(res.error));
  return res?.result;
};

const waitForStudioEvmReceipt = async (txHash, maxRetries = 24, intervalMs = 2000) => {
  for (let i = 0; i < maxRetries; i++) {
    const receipt = await studioRpc('eth_getTransactionReceipt', [txHash]).catch(() => null);
    if (receipt) {
      const status = receipt.status;
      if (status === '0x0' || status === 0 || status === '0') {
        throw new Error('Studionet transaction reverted. Contract state was not changed.');
      }
      await new Promise((r) => setTimeout(r, 1500));
      return receipt;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for Studionet receipt ${txHash}.`);
};

const studionetChainIdHex = () => {
  const id = Number((officialStudionet || studionet).id || 61999);
  return `0x${id.toString(16)}`;
};

export const switchToGenlayerStudionet = async () => {
  if (typeof window === 'undefined' || !window.ethereum) return;
  const chainIdHex = studionetChainIdHex();
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      try {
        const chain = officialStudionet || studionet;
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainIdHex,
            chainName: chain.name || 'GenLayer Studionet',
            nativeCurrency: chain.nativeCurrency || {
              name: 'GenLayer Token',
              symbol: 'GEN',
              decimals: 18,
            },
            rpcUrls: chain.rpcUrls?.default?.http || ['https://studio.genlayer.com/api'],
            blockExplorerUrls: [chain.blockExplorers?.default?.url || EXPLORER_BASE],
          }],
        });
      } catch (addError) {
        console.warn('Could not add GenLayer Studionet network to MetaMask:', addError);
      }
    }
  }
};

export const sendContractTransaction = async ({
  from,
  to,
  functionName,
  args = [],
  value = 0n,
}) => {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Signed Web3 Wallet Required: Please connect MetaMask to execute write transactions on GenLayer.');
  }
  if (!isValidContractAddress(to)) {
    throw new Error('Contract address is not configured yet. Deploy on GenLayer Studio first.');
  }

  const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const sender = toAddress(from) || (accs && accs[0]);
  if (!sender) {
    throw new Error('No connected wallet account found. Please connect MetaMask to execute write actions.');
  }

  await switchToGenlayerStudionet();

  const client = getGenlayerClient(sender);
  if (!client || !client.writeContract) {
    throw new Error('GenLayer write client is not available.');
  }

  const writeAccount = toWriteAccount(sender);
  try {
    return await client.writeContract({
      account: writeAccount,
      address: to,
      functionName,
      args,
      value: toValueBigInt(value),
    });
  } catch (err) {
    throw new Error(formatWriteError(err));
  }
};

export const waitForFinalizedTx = async (txHash, maxRetries = 24, intervalMs = 2000) => {
  if (!txHash) {
    throw new Error('Missing transaction hash.');
  }

  try {
    return await waitForStudioEvmReceipt(txHash, maxRetries, intervalMs);
  } catch (studioErr) {
    const studioMsg = String(studioErr?.message || '').toLowerCase();
    if (studioMsg.includes('reverted')) throw studioErr;
    const client = getGenlayerClient();
    if (!client || !client.waitForTransactionReceipt) {
      throw studioErr;
    }
    try {
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        retries: Math.min(maxRetries, 12),
        interval: intervalMs,
      });
      const execName = receipt?.txExecutionResultName || receipt?.executionResult || receipt?.txExecutionResult;
      if (execName === ExecutionResult.FINISHED_WITH_ERROR) {
        const detail = receipt?.txExecutionError || receipt?.stderr || receipt?.verdict_reason || '';
        throw new Error('Contract execution failed. State was not changed. ' + String(detail));
      }
      return receipt;
    } catch {
      throw studioErr;
    }
  }
};

export const readContractState = async (functionName, args = [], targetAddress) => {
  const addr = targetAddress;
  if (!isValidContractAddress(addr)) return null;
  try {
    const client = getGenlayerClient();
    if (client && client.readContract) {
      const result = await client.readContract({
        address: addr,
        functionName,
        args,
        stateStatus: 'accepted',
      });
      if (isHexStub(result)) return null;
      return unwrapViewResult(result);
    }
  } catch (err) {
    console.warn(`readContract ${functionName} note:`, err);
  }

  try {
    const calldata = encodeGenLayerCalldata(functionName, args);
    const res = await fetch(STUDIO_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: addr, data: calldata }, 'latest'],
      }),
    }).then((r) => r.json());
    return unwrapViewResult(res?.result);
  } catch (err) {
    console.warn('eth_call RPC error:', err);
    return null;
  }
};

export const txExplorerUrl = (hash) => {
  if (!hash) return EXPLORER_BASE;
  return `${EXPLORER_BASE}/tx/${hash}`;
};

export const addressExplorerUrl = (addr) => {
  if (!addr) return EXPLORER_BASE;
  return `${EXPLORER_BASE}/address/${addr}`;
};
