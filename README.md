# AppealDAO — Mutual-aid creator appeals on GenLayer

Creator channels get banned or demonetized by platforms with opaque, slow, or missing appeal paths. **AppealDAO** is a community pool on **GenLayer Studionet** where creators file a fixed-deposit appeal, GenLayer AI compares the flagged content against the platform's own public policy, and a **binary verdict** settles the money:

- **OVERTURNED** — the ban does not match the stated policy. The creator receives the deposit back plus a fixed bonus taken from the community pool (`min(bonus, pool_balance)`). The deposit is always returned in full.
- **UPHELD** — the ban matches the policy (or evidence is insufficient). The deposit is added to the community pool. No transfer is sent.

**Pitch:** AppealDAO dies without GenLayer. No EVM contract can read a ban notice against a platform's natural-language community guidelines, and no platform will build a neutral appeals desk for small creators. Only GenLayer's cheap AI consensus can adjudicate this, while the creator community insures itself through one shared pool.

This dApp targets **hosted GenLayer Studionet only**. It is not deployed to Asimov/Bradbury testnet.

---

## Live App

**URL:** [https://appealdao-genlayer.vercel.app](https://appealdao-genlayer.vercel.app)

This dApp is deployed against **hosted GenLayer Studionet**. It is **not** deployed to Asimov/Bradbury testnet.

**How to try:**
1. Install MetaMask. Open the live URL and click **Connect MetaMask**. The app adds/switches to Studionet.
2. Fund the connected address with GEN from [GenLayer Studio](https://studio.genlayer.com) → **Accounts** (not the public testnet faucet).
3. Contribute to the community pool, then file an appeal with evidence URLs and at least two independent policy references.
4. Click **Request AI adjudication** and wait for the on-chain binary verdict.

---

## Deployed Contract (Studionet)

- **Address:** `0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC`
- **Explorer:** [https://genlayer-explorer.vercel.app/address/0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC](https://genlayer-explorer.vercel.app/address/0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC)

---

## Architecture

One Intelligent Contract holds both the community pool and every appeal deposit. There are no cross-contract transfers.

| Piece | Path |
|---|---|
| Contract | [`contracts/appeal_dao.py`](contracts/appeal_dao.py) |
| Tests | [`tests/test_appeal_dao.py`](tests/test_appeal_dao.py) |
| Frontend | [`frontend/`](frontend/) |
| Studionet deploy notes | [`scripts/deploy/studionet.md`](scripts/deploy/studionet.md) |

### Verified GenLayer APIs (do not replace)

- Caller: `gl.message.sender_address` (not `gl.message.sender`)
- Native GEN out: `gl.get_contract_at(recipient).emit_transfer(value=u256(amount))` (not `gl.transfer`)
- Native GEN in: `@gl.public.write` + `gl.message.value` (there is no `@gl.public.write.payable`)
- Map default: `TreeMap.get(key, default)`
- Header:
  ```python
  # v0.2.16
  # { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
  ```

### Resolve flow

1. Owner calls `set_config(deposit_wei, bonus_wei)` — both must be `> 0`.
2. Anyone calls `fund_pool` with GEN. That amount is added to `pool_balance`.
3. Creator calls `file_appeal` with **exactly** `appeal_deposit_amount`, a platform name, a description, ≥1 flagged-content URL, and ≥2 independent policy URLs.
4. Anyone calls `resolve_appeal`. Leader fetches the URLs, prompts the model, returns `OVERTURNED | UPHELD`. Validators agree on the **verdict string only** (absolute compare, no tolerance).
5. `confidence < 60` or an invalid verdict → `DISPUTED`. Creator may `add_evidence` and resolve again.
6. `UPHELD` → `pool_balance += deposit`. No transfer.
7. `OVERTURNED` → `bonus = min(overturned_bonus_amount, pool_balance)`, pay `deposit + bonus`. If `emit_transfer` fails, the bonus debit is rolled back, status becomes `PAYOUT_FAILED`, and `retry_resolution` pays the **locked** `final_payout_amount` (no AI, no bonus recalc).

---

## Money handling — itemized (no floats, no percents)

Every GEN amount is **integer wei** (`1 GEN = 10^18`). There is no `float`, `parseFloat`, `Math.round`, `Math.floor`, or runtime percentage on money.

| Location | What | Unit | How it is computed |
|---|---|---|---|
| `set_config` | `appeal_deposit_amount`, `overturned_bonus_amount` | wei `bigint` | Stored as given. Both must be `> 0`. |
| `fund_pool` | incoming `gl.message.value` | wei `bigint` | `pool_balance = pool_balance + amount` |
| `file_appeal` | incoming `gl.message.value` | wei `bigint` | Must **equal** `appeal_deposit_amount`. Stored as `deposit_paid`. Not added to `pool_balance` yet. |
| `resolve_appeal` UPHELD | deposit → pool | wei `bigint` | `pool_balance = pool_balance + deposit_paid`. No transfer. |
| `resolve_appeal` OVERTURNED bonus | capped bonus | wei `bigint` | `bonus = bonus_config if bonus_config <= pool_balance else pool_balance` (integer min, not a %) |
| `resolve_appeal` OVERTURNED payout | creator payment | wei `bigint` | `total = deposit_paid + bonus`. Transfer via `emit_transfer`. |
| Transfer failure | rollback | wei `bigint` | If transfer throws, `pool_balance += bonus` (only the bonus that was just subtracted). `final_payout_amount` stays locked. |
| `retry_resolution` | locked payout | wei `bigint` | Transfers `final_payout_amount` as stored at resolve time. Does not re-read `pool_balance` to change the bonus. |
| Views (`get_config`, `get_appeal`, `get_pool_balance`) | all money fields | **decimal string** of wei | `str(bigint)` so JSON never uses IEEE-754 numbers. |
| Frontend `parseGenToWei` | GEN string → wei | `BigInt` | Split on `.`, pad/trim 18 fractional digits, concatenate, `BigInt(...)`. |
| Frontend `formatWeiToGen` | wei → GEN string | string | `wei / 10^18` and `wei % 10^18` with `BigInt`. Trailing zeros stripped. JS `number` inputs rejected. |
| Frontend `sanitizeGenInput` | amount field | decimal string | Digits + one dot, max 18 fractional digits. |
| Frontend `fund_pool` `value` | write tx | `bigint` | `parseGenToWei(fundGen)` |
| Frontend `file_appeal` `value` | write tx | `bigint` | `BigInt(toWeiString(config.appeal_deposit_amount))` — exact on-chain deposit, never typed as a float. |
| Frontend `set_config` args | write tx | `bigint` | `parseGenToWei(depositGen)`, `parseGenToWei(bonusGen)` |
| Display of pool / deposit / bonus / payout | UI | GEN string | `formatWeiToGen(weiFromField(...))` only. |
| Confidence | 0–100 integer | not money | `toPercentInt` on a 0–100 `BigInt`. Not used in payout math. |

Prebuild guard: `scripts/check-no-float-money.js` scans `frontend/src/**/*.{js,jsx}` and fails the build if `parseFloat` / `Math.round` / `Math.floor` / `Math.ceil` appear near `deposit|bonus|pool|balance|payout|wei|gen|amount`. Hooked as `"prebuild"` in `frontend/package.json`.

---

## Tests

```bash
pip install -r requirements-dev.txt
pytest tests/test_appeal_dao.py
```

Required cases:

1. Happy path `OVERTURNED` with a funded pool → creator receives deposit + full bonus.
2. Happy path `OVERTURNED` with a short pool → creator receives deposit + `min(bonus, pool)`; tx does not fail.
3. Happy path `UPHELD` → deposit added to pool, no transfer.
4. Wrong deposit (too low / too high) blocked.
5. Missing flagged URL / fewer than 2 policy URLs blocked.
6. `confidence < 60` → `DISPUTED` → `add_evidence` → resolve again.
7. Broken LLM JSON → `DISPUTED`. Unfetched flagged URL → resolve reverts, status stays `SUBMITTED`.
8. Double-resolve blocked.
9. Forced `emit_transfer` failure on OVERTURNED → bonus rolled back, `PAYOUT_FAILED` → `retry_resolution` pays the locked `final_payout_amount`.
10. Wei round-trip at `10^18`.

Frontend money helpers:

```bash
cd frontend
node src/__tests__/unit_conversion.test.js
npm run check:float
```

---

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens `http://localhost:3000`.

- Until `VITE_CONTRACT_ADDRESS` is set, a yellow banner explains that Studio deploy is pending. The page does not crash.
- Connect MetaMask; the app switches/adds **GenLayer Studionet**.
- Home shows live `pool_balance`, `appeal_deposit_amount`, and `overturned_bonus_amount` before anyone files.
- Platform is a chip (YouTube / TikTok / X / Instagram / Other). The only free-text field is the content description. Evidence/policy URLs use paste + presets.
- **Request AI adjudication** shows a loading state while nondet consensus runs.
- `DISPUTED` → add evidence. `PAYOUT_FAILED` → retry.

Environment:

```env
VITE_CONTRACT_ADDRESS=0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC
```

Current Studionet deployment: `0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC`. Owner must call `set_config` before the first appeal can be filed.

---

## Deploy Studionet (manual)

See [`scripts/deploy/studionet.md`](scripts/deploy/studionet.md). Summary:

1. Paste `contracts/appeal_dao.py` into [GenLayer Studio](https://studio.genlayer.com/run-debug).
2. Deploy. Confirm **`Result: SUCCESS`**.
3. Set `VITE_CONTRACT_ADDRESS`, call `set_config` from the owner wallet, then ship the frontend.

**Contract address:** [`0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC`](https://genlayer-explorer.vercel.app/address/0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC)

---

## Known limits

- `retry_resolution` pays the locked `final_payout_amount` and does not recompute bonus from the current pool. That is intentional so the original verdict's payout cannot change.
- Fetch failures inside `resolve_appeal` raise `UserError` (the transaction reverts). Broken JSON does not revert; it marks the appeal `DISPUTED`.
- Network is Studionet only. Do not point the client at testnet.
