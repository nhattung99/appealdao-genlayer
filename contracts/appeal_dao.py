# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json

UserError = gl.vm.UserError

VALID_VERDICTS = ("OVERTURNED", "UPHELD")
MIN_CONFIDENCE = 60
MIN_FLAGGED_URLS = 1
MIN_POLICY_URLS = 2
RENDER_CHAR_CAP = 2000
ZERO_ADDR = Address("0x0000000000000000000000000000000000000000")


def _addr_str(a) -> str:
    if isinstance(a, (bytes, bytearray)):
        return ("0x" + bytes(a).hex()).lower()
    try:
        return str(a.as_hex).lower()
    except Exception:
        pass
    s = str(a).lower().strip()
    if s.startswith("0x"):
        return s
    if len(s) == 40:
        return "0x" + s
    return s


def _to_address(val) -> Address:
    if isinstance(val, Address):
        return val
    if isinstance(val, bytes):
        return Address("0x" + val.hex())
    if isinstance(val, str):
        val_str = val.strip()
        if not val_str.startswith("0x"):
            val_str = "0x" + val_str
        return Address(val_str)
    if hasattr(val, "as_hex"):
        return val
    try:
        return Address(val)
    except Exception:
        return Address("0x" + bytes(val).hex())


def _same_addr(a, b) -> bool:
    return _addr_str(a) == _addr_str(b)


def _urls_to_list(urls) -> list:
    out = []
    try:
        n = len(urls)
    except Exception:
        return out
    for i in range(n):
        out.append(str(urls[i]))
    return out


def _clean_http_urls(urls, kind: str, minimum: int) -> list:
    cleaned = []
    for u in urls:
        url = str(u).strip()
        if not url:
            continue
        if not (url.startswith("http://") or url.startswith("https://")):
            raise UserError("Invalid " + kind + " URL: must start with http:// or https://")
        cleaned.append(url)
    if len(cleaned) < minimum:
        raise UserError("At least " + str(minimum) + " " + kind + " URL(s) required")
    return cleaned


def _leader_payload(leader_res):
    if hasattr(leader_res, "value") and isinstance(leader_res.value, dict):
        return leader_res.value
    if hasattr(leader_res, "calldata") and isinstance(leader_res.calldata, dict):
        return leader_res.calldata
    if isinstance(leader_res, dict):
        return leader_res
    return None


def _extract_result(result) -> dict:
    payload = _leader_payload(result)
    if payload is None:
        raise UserError("Invalid nondet consensus result")
    return payload


def _parse_verdict(raw) -> dict:
    if isinstance(raw, dict):
        data = raw
    else:
        cleaned = str(raw).strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if len(lines) >= 2 and lines[0].startswith("```"):
                lines = lines[1:]
            if len(lines) >= 1 and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        try:
            data = json.loads(cleaned)
        except Exception as e:
            return {
                "verdict": "",
                "confidence": 0,
                "reason": "Failed to parse LLM response. Error: " + str(e),
            }

    if not isinstance(data, dict):
        return {
            "verdict": "",
            "confidence": 0,
            "reason": "AI verdict response must be a JSON object",
        }

    verdict = str(data.get("verdict", "")).strip().upper()
    if verdict not in VALID_VERDICTS:
        return {
            "verdict": "",
            "confidence": 0,
            "reason": "verdict must be OVERTURNED or UPHELD — got: " + verdict,
        }

    try:
        conf = int(data.get("confidence", 0))
    except Exception:
        conf = 0
    if conf < 0 or conf > 100:
        conf = 0

    return {
        "verdict": verdict,
        "confidence": conf,
        "reason": str(data.get("reason", "")),
    }


def _bound_page_text(text) -> str:
    s = str(text or "")
    s = s.replace("<<<", "[").replace(">>>", "]").replace("```", "'''")
    if len(s) > RENDER_CHAR_CAP:
        s = s[:RENDER_CHAR_CAP]
    return s


def _fetch_url(url: str, kind: str) -> str:
    try:
        res = gl.nondet.web.render(url)
        raw = res.body if hasattr(res, "body") else res
        body = _bound_page_text(raw)
    except Exception:
        raise UserError("Failed to fetch " + kind + " URL: " + url)
    if len(body.strip()) == 0:
        raise UserError("Failed to fetch " + kind + " URL: " + url)
    return "[" + url + "]: " + body


def _pay(recipient, amount) -> None:
    if amount <= bigint(0):
        return
    gl.get_contract_at(_to_address(recipient)).emit_transfer(value=u256(amount))


@allow_storage
@dataclass
class Appeal:
    creator: Address
    platform_name: str
    content_description: str
    flagged_content_urls: DynArray[str]
    policy_reference_urls: DynArray[str]
    deposit_paid: bigint
    status: str
    verdict: str
    verdict_reason: str
    confidence: u256
    final_payout_amount: bigint
    settled: bool


class Contract(gl.Contract):
    owner: Address
    appeal_deposit_amount: bigint
    overturned_bonus_amount: bigint
    pool_balance: bigint
    appeal_counter: bigint
    appeals: TreeMap[str, Appeal]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.appeal_deposit_amount = bigint(0)
        self.overturned_bonus_amount = bigint(0)
        self.pool_balance = bigint(0)
        self.appeal_counter = bigint(0)

    @gl.public.write
    def set_config(self, appeal_deposit_amount: bigint, overturned_bonus_amount: bigint) -> None:
        if not _same_addr(gl.message.sender_address, self.owner):
            raise UserError("Only owner can set config")
        if appeal_deposit_amount <= bigint(0) or overturned_bonus_amount <= bigint(0):
            raise UserError("Both amounts must be greater than 0")
        self.appeal_deposit_amount = appeal_deposit_amount
        self.overturned_bonus_amount = overturned_bonus_amount

    @gl.public.write
    def fund_pool(self) -> None:
        """Anyone can contribute to the mutual-aid community pool."""
        amount = bigint(gl.message.value)
        if amount <= bigint(0):
            raise UserError("Must send GEN to fund the pool")
        self.pool_balance = self.pool_balance + amount

    @gl.public.write
    def file_appeal(
        self,
        platform_name: str,
        content_description: str,
        flagged_content_urls: DynArray[str],
        policy_reference_urls: DynArray[str],
    ) -> str:
        if self.appeal_deposit_amount <= bigint(0):
            raise UserError("Appeal deposit amount not configured yet")
        deposit_sent = bigint(gl.message.value)
        if deposit_sent != self.appeal_deposit_amount:
            raise UserError("Must send exact deposit amount: " + str(self.appeal_deposit_amount))
        if not platform_name or len(str(platform_name).strip()) == 0:
            raise UserError("Platform name cannot be empty")
        if not content_description or len(str(content_description).strip()) == 0:
            raise UserError("Content description cannot be empty")

        flagged = _clean_http_urls(flagged_content_urls, "flagged content", MIN_FLAGGED_URLS)
        policies = _clean_http_urls(policy_reference_urls, "policy reference", MIN_POLICY_URLS)

        appeal_id = str(self.appeal_counter)
        self.appeal_counter = self.appeal_counter + bigint(1)

        self.appeals[appeal_id] = Appeal(
            creator=gl.message.sender_address,
            platform_name=str(platform_name).strip(),
            content_description=str(content_description).strip(),
            flagged_content_urls=flagged,
            policy_reference_urls=policies,
            deposit_paid=deposit_sent,
            status="SUBMITTED",
            verdict="",
            verdict_reason="",
            confidence=u256(0),
            final_payout_amount=bigint(0),
            settled=False,
        )
        return appeal_id

    @gl.public.write
    def add_evidence(
        self,
        appeal_id: str,
        additional_flagged_urls: DynArray[str],
        additional_policy_urls: DynArray[str],
    ) -> None:
        if appeal_id not in self.appeals:
            raise UserError("Appeal does not exist")
        a = self.appeals[appeal_id]
        if not _same_addr(gl.message.sender_address, a.creator):
            raise UserError("Only the appealing creator can add evidence")
        if a.status != "DISPUTED":
            raise UserError("Can only add evidence to DISPUTED appeals, current status: " + a.status)

        extra_flagged = _clean_http_urls(additional_flagged_urls, "flagged content", 0)
        extra_policy = _clean_http_urls(additional_policy_urls, "policy reference", 0)
        if len(extra_flagged) < 1 and len(extra_policy) < 1:
            raise UserError("At least 1 additional URL is required")

        for url in extra_flagged:
            a.flagged_content_urls.append(url)
        for url in extra_policy:
            a.policy_reference_urls.append(url)
        a.status = "SUBMITTED"
        a.verdict_reason = "Supplemental evidence attached for re-evaluation"
        self.appeals[appeal_id] = a

    @gl.public.write
    def resolve_appeal(self, appeal_id: str) -> None:
        if appeal_id not in self.appeals:
            raise UserError("Appeal does not exist")
        a = self.appeals[appeal_id]
        if a.status not in ["SUBMITTED", "DISPUTED"]:
            raise UserError("Appeal not ready for resolution (status: " + a.status + ")")

        platform_name = a.platform_name
        content_desc = a.content_description
        flagged_urls_list = _urls_to_list(a.flagged_content_urls)
        policy_urls_list = _urls_to_list(a.policy_reference_urls)

        def leader_fn() -> dict:
            flagged_contents = []
            for url in flagged_urls_list:
                flagged_contents.append(_fetch_url(url, "flagged content"))

            policy_contents = []
            for url in policy_urls_list:
                policy_contents.append(_fetch_url(url, "policy reference"))

            prompt = f"""You are a neutral content moderation appeal adjudicator.
Platform: "{platform_name}"
Creator's description of what was flagged/banned: "{content_desc}"
Evidence of the flagged content / ban notice: {flagged_contents}
The platform's own publicly stated policy (independent reference, use this as ground truth): {policy_contents}

Decide strictly one of two outcomes:
- "OVERTURNED": the flagged content/action does NOT genuinely violate the platform's own stated policy — the ban was incorrect.
- "UPHELD": the flagged content/action does genuinely violate the platform's stated policy, or evidence is insufficient to prove otherwise.

Return ONLY raw JSON, no markdown:
{{"verdict": "OVERTURNED" | "UPHELD", "confidence": <0-100>, "reason": "<short justification>"}}"""

            raw = gl.nondet.exec_prompt(prompt)
            return _parse_verdict(raw)

        def validator_fn(leader_res) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                return False
            leader_val = _leader_payload(leader_res)
            if not isinstance(leader_val, dict) or "verdict" not in leader_val:
                return False
            try:
                my_res = leader_fn()
            except Exception:
                return False
            return str(my_res.get("verdict", "")).upper() == str(leader_val.get("verdict", "")).upper()

        result = _extract_result(gl.vm.run_nondet(leader_fn, validator_fn))

        a.verdict = str(result.get("verdict", ""))
        try:
            conf_int = int(result.get("confidence", 0))
        except Exception:
            conf_int = 0
        if conf_int < 0:
            conf_int = 0
        if conf_int > 100:
            conf_int = 100
        a.confidence = u256(conf_int)
        a.verdict_reason = str(result.get("reason", ""))

        if conf_int < MIN_CONFIDENCE or a.verdict not in VALID_VERDICTS:
            a.status = "DISPUTED"
            self.appeals[appeal_id] = a
            return

        if a.verdict == "UPHELD":
            self.pool_balance = self.pool_balance + a.deposit_paid
            a.status = "RESOLVED_UPHELD"
            a.settled = True
            self.appeals[appeal_id] = a
            return

        bonus = self.overturned_bonus_amount if self.overturned_bonus_amount <= self.pool_balance else self.pool_balance
        total_payout = a.deposit_paid + bonus
        a.final_payout_amount = total_payout

        if bonus > bigint(0):
            self.pool_balance = self.pool_balance - bonus

        try:
            _pay(a.creator, total_payout)
            a.settled = True
            a.status = "RESOLVED_OVERTURNED"
        except Exception as e:
            if bonus > bigint(0):
                self.pool_balance = self.pool_balance + bonus
            a.settled = False
            a.status = "PAYOUT_FAILED"
            a.verdict_reason += " (Transfer failed: " + str(e) + ")"

        self.appeals[appeal_id] = a

    @gl.public.write
    def retry_resolution(self, appeal_id: str) -> None:
        """Retry payout if PAYOUT_FAILED. Reuses locked final_payout_amount — no AI, no bonus recalc."""
        if appeal_id not in self.appeals:
            raise UserError("Appeal does not exist")
        a = self.appeals[appeal_id]
        if not _same_addr(gl.message.sender_address, a.creator):
            raise UserError("Only the appealing creator can retry")
        if a.status != "PAYOUT_FAILED":
            raise UserError("Can only retry PAYOUT_FAILED appeals")

        try:
            _pay(a.creator, a.final_payout_amount)
            a.settled = True
            a.status = "RESOLVED_OVERTURNED"
        except Exception as e:
            a.verdict_reason += " (Retry failed again: " + str(e) + ")"
        self.appeals[appeal_id] = a

    def _appeal_dict(self, appeal_id: str, a: Appeal, full: bool) -> dict:
        row = {
            "id": appeal_id,
            "creator": _addr_str(a.creator),
            "platform_name": a.platform_name,
            "content_description": a.content_description,
            "deposit_paid": str(a.deposit_paid),
            "status": a.status,
            "verdict": a.verdict,
            "verdict_reason": a.verdict_reason,
            "confidence": int(a.confidence),
            "final_payout_amount": str(a.final_payout_amount),
            "settled": bool(a.settled),
        }
        if full:
            row["flagged_content_urls"] = _urls_to_list(a.flagged_content_urls)
            row["policy_reference_urls"] = _urls_to_list(a.policy_reference_urls)
        return row

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "owner": _addr_str(self.owner),
            "appeal_deposit_amount": str(self.appeal_deposit_amount),
            "overturned_bonus_amount": str(self.overturned_bonus_amount),
            "pool_balance": str(self.pool_balance),
            "appeal_counter": str(self.appeal_counter),
            "configured": self.appeal_deposit_amount > bigint(0) and self.overturned_bonus_amount > bigint(0),
        }

    @gl.public.view
    def get_pool_balance(self) -> str:
        return str(self.pool_balance)

    @gl.public.view
    def get_appeal(self, appeal_id: str) -> dict:
        if appeal_id not in self.appeals:
            return {}
        return self._appeal_dict(appeal_id, self.appeals[appeal_id], True)

    @gl.public.view
    def list_appeals(self) -> str:
        results = []
        n = int(self.appeal_counter)
        for i in range(n):
            aid = str(i)
            if aid in self.appeals:
                results.append(self._appeal_dict(aid, self.appeals[aid], False))
        return json.dumps(results)

    @gl.public.view
    def get_appeal_count(self) -> int:
        return int(self.appeal_counter)

    @gl.public.view
    def get_owner(self) -> str:
        return _addr_str(self.owner)
