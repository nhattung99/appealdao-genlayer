import { createClient } from 'genlayer-js';
import { studionet as officialStudionet } from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';
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
const VIEW_FROM = '0x0000000000000000000000000000000000000001';
const STUDIO_RPC = 'https://studio.genlayer.com/api';
const rawAddress = (import.meta.env.VITE_CONTRACT_ADDRESS || '').trim();

export const DEFAULT_CONTRACT_ADDRESS = rawAddress;
export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com';

export const isValidContractAddress = (addr) => {
  const s = String(addr || '').trim();
  return Boolean(s && s !== ZERO && /^0x[0-9a-fA-F]{40}$/.test(s));
};

export const hasContractAddress = isValidContractAddress(rawAddress);

export const studionet = officialStudionet || {
  id: 61999,
  name: 'GenLayer Studionet',
  rpcUrls: { default: { http: [STUDIO_RPC] } },
  nativeCurrency: {
    name: 'GEN Token',
    symbol: 'GEN',
    decimals: 18,
  },
};

/** Same-origin proxy in browser (Vite + Vercel). Direct Studio RPC in Node. */
export const studioRpcUrl = (origin) => {
  if (!origin || typeof origin !== 'string') return STUDIO_RPC;
  return `${origin.replace(/\/$/, '')}/api/genlayer`;
};

const browserOrigin = () => (typeof window !== 'undefined' ? window.location.origin : '');

function studioChain() {
  const endpoint = studioRpcUrl(browserOrigin());
  return {
    ...studionet,
    rpcUrls: {
      default: { http: [endpoint] },
    },
  };
}

const toAddress = (account) => {
  if (!account) return '';
  if (typeof account === 'string') return account.trim();
  return String(account.address || '').trim();
};

/**
 * MetaMask routing in genlayer-js only fires when client.account is a hex string
 * (typeof !== "object"). Encoding needs { address } or _sender is undefined.
 */
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

export const asPlain = (val) => {
  if (val instanceof Map) {
    const obj = {};
    for (const [k, v] of val.entries()) obj[String(k)] = asPlain(v);
    return obj;
  }
  if (Array.isArray(val)) return val.map(asPlain);
  if (typeof val === 'bigint') return val.toString();
  return val;
};

export const unwrapViewResult = (val) => {
  const plain = asPlain(val);
  if (plain === null || plain === undefined) return plain;
  if (typeof plain === 'string') {
    const trimmed = plain.trim();
    if (/^0x[0-9a-fA-F]+$/.test(trimmed) && trimmed.length > 4 && trimmed.length % 2 === 0) {
      try {
        const hex = trimmed.slice(2);
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i += 1) {
          bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        const text = new TextDecoder().decode(bytes).trim();
        if (text.startsWith('[') || text.startsWith('{') || /^\d+$/.test(text)) {
          return unwrapViewResult(text);
        }
      } catch {
        /* keep original */
      }
    }
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return unwrapViewResult(JSON.parse(trimmed));
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
  if (low.includes('reverted')) {
    return 'Studionet transaction reverted. Contract state was not changed. Check deposit amount / evidence URLs and retry.';
  }
  if (low.includes('timed out') || low.includes('timeout')) {
    return 'Timed out waiting for Studionet confirmation. If MetaMask already confirmed, wait 30s and hit Refresh — do not resend yet.';
  }
  return msg || 'Write transaction failed.';
};

const toValueBigInt = (value) => {
  if (typeof value === 'bigint') return value < 0n ? 0n : value;
  if (typeof value === 'number') return 0n;
  const raw = String(value ?? '0').trim();
  if (raw === '' || raw === '0x' || raw === '0x0') return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
};

const extractTxHash = (raw) => {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    return String(raw.hash || raw.transactionHash || raw.txHash || raw.id || '');
  }
  return String(raw);
};

export const getGenlayerClient = (account) => {
  try {
    const cfg = {
      chain: studioChain(),
    };
    const address = toAddress(account);
    // Hex string (not object) so MetaMask provider routing is enabled in genlayer-js.
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

const studioRpc = async (method, params = []) => {
  const endpoint = studioRpcUrl(browserOrigin());
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  }).then((r) => r.json());
  if (res?.error) throw new Error(res.error.message || JSON.stringify(res.error));
  return res?.result;
};

const waitForStudioEvmReceipt = async (txHash, maxRetries = 40, intervalMs = 2500) => {
  for (let i = 0; i < maxRetries; i++) {
    const receipt = await studioRpc('eth_getTransactionReceipt', [txHash]).catch(() => null);
    if (receipt) {
      const status = receipt.status;
      if (status === '0x0' || status === 0 || status === '0') {
        throw new Error('Studionet transaction reverted. Contract state was not changed.');
      }
      // Give GenVM a moment after EVM inclusion before reads.
      await new Promise((r) => setTimeout(r, 2000));
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
  const rpc = studioRpcUrl(window.location.origin);
  const chain = officialStudionet || studionet;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError) {
    const missing =
      switchError?.code === 4902 ||
      String(switchError?.message || '').toLowerCase().includes('unrecognized chain');
    if (!missing) throw switchError;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        chainName: chain.name || 'GenLayer Studionet',
        nativeCurrency: chain.nativeCurrency || {
          name: 'GEN Token',
          symbol: 'GEN',
          decimals: 18,
        },
        rpcUrls: [rpc],
        blockExplorerUrls: [chain.blockExplorers?.default?.url || EXPLORER_BASE],
      }],
    });
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

  // Do not call client.connect('studionet'): it requests a MetaMask Snap and blocks regular wallets.
  await switchToGenlayerStudionet();

  const client = getGenlayerClient(sender);
  if (!client || !client.writeContract) {
    throw new Error('GenLayer write client is not available.');
  }

  const valueWei = toValueBigInt(value);
  const writeAccount = toWriteAccount(sender);

  try {
    const raw = await client.writeContract({
      // Object form required so addTransaction _sender is populated.
      account: writeAccount,
      address: to,
      functionName,
      args,
      value: valueWei,
    });
    const hash = extractTxHash(raw);
    if (!hash) {
      throw new Error('writeContract returned no transaction hash.');
    }
    return hash;
  } catch (err) {
    throw new Error(formatWriteError(err));
  }
};

export const waitForFinalizedTx = async (txHash, maxRetries = 40, intervalMs = 2500) => {
  const hash = extractTxHash(txHash);
  if (!hash) throw new Error('Missing transaction hash.');

  try {
    return await waitForStudioEvmReceipt(hash, maxRetries, intervalMs);
  } catch (studioErr) {
    const studioMsg = String(studioErr?.message || '').toLowerCase();
    if (studioMsg.includes('reverted')) throw studioErr;

    const client = getGenlayerClient();
    if (client && client.waitForTransactionReceipt) {
      try {
        const receipt = await client.waitForTransactionReceipt({
          hash,
          status: TransactionStatus.ACCEPTED,
          retries: Math.min(maxRetries, 20),
          interval: intervalMs,
        });
        return receipt;
      } catch (err) {
        console.warn('waitForTransactionReceipt note:', err);
      }
    }
    // Soft-timeout: allow caller to confirm via on-chain state polling.
    return { hash, pending: true, warning: String(studioErr?.message || studioErr) };
  }
};

/**
 * Poll a view until `predicate(result)` is true, or timeout.
 * Used after payable writes because Studionet GenVM execution lags the EVM receipt.
 */
export const waitForContractEffect = async ({
  read,
  predicate,
  retries = 30,
  intervalMs = 2000,
  label = 'contract state',
}) => {
  let last = null;
  for (let i = 0; i < retries; i++) {
    try {
      last = await read();
      if (await predicate(last)) return last;
    } catch (err) {
      console.warn(`waitForContractEffect(${label}) read note:`, err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timed out waiting for ${label} to update on Studionet. Refresh the page; if state is still unchanged, the transaction did not land.`
  );
};

export const readContractState = async (functionName, args = [], targetAddress, fromAddress) => {
  const addr = targetAddress;
  if (!isValidContractAddress(addr)) return null;

  try {
    const client = getGenlayerClient(fromAddress || VIEW_FROM);
    if (client && client.readContract) {
      const result = await client.readContract({
        address: addr,
        functionName,
        args,
        account: toWriteAccount(fromAddress || VIEW_FROM),
        stateStatus: 'accepted',
      });
      return unwrapViewResult(result);
    }
  } catch (err) {
    console.warn(`readContract ${functionName} note:`, err);
  }

  // Fallback: eth_call via same-origin Studio proxy (no custom calldata encoder needed for views).
  try {
    const client = getGenlayerClient(VIEW_FROM);
    if (client && client.readContract) {
      const result = await client.readContract({
        address: addr,
        functionName,
        args,
        account: { address: VIEW_FROM },
      });
      return unwrapViewResult(result);
    }
  } catch (err) {
    console.warn(`readContract fallback ${functionName} note:`, err);
  }
  return null;
};

export const txExplorerUrl = (hash) => {
  if (!hash) return EXPLORER_BASE;
  return `${EXPLORER_BASE}/tx/${hash}`;
};

export const addressExplorerUrl = (addr) => {
  if (!addr) return EXPLORER_BASE;
  return `${EXPLORER_BASE}/address/${addr}`;
};
