# Deploy AppealDAO to GenLayer Studionet

Do **not** switch the app to Asimov/Bradbury testnet. Studionet only.

1. Open [GenLayer Studio Run & Debug](https://studio.genlayer.com/run-debug).
2. Settings → **Reset Storage** if the environment is dirty, then hard-refresh.
3. Paste [`contracts/appeal_dao.py`](../../contracts/appeal_dao.py). Keep the two-line header:
   ```
   # v0.2.16
   # { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
   ```
4. Click **Deploy**. Open the transaction and confirm **`Result: SUCCESS`** — `FINALIZED` alone is not enough.
5. Copy the address into `frontend/.env`:
   ```
   VITE_CONTRACT_ADDRESS=0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC
   ```
6. Call `set_config(appeal_deposit_amount, overturned_bonus_amount)` from the owner wallet (both amounts in wei, both > 0) before filing appeals.
7. Fund MetaMask from Studio → **Accounts** (not the public testnet faucet).

Current Studionet deployment: [`0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC`](https://genlayer-explorer.vercel.app/address/0x8116D8Eaeb6062F060B8fAbC0fa8249A61e9DdbC).
